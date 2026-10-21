/**
 * Dedicated Web Worker entry. The Node-compatibility layer this app owns is
 * handed to the host assembly as the module table plus the captured request
 * listener; the assembly owns everything else (process global, VFS image,
 * Cordis tree, tunnel server).
 *
 * The assembly needs the base image and selected overlays before it can exist;
 * they arrive in the tunnel's opening `init` frame. This bundle reads nothing
 * from its own URL, so the deployment decides where every archive lives.
 * Messages before `init` queue here; requests during boot queue inside the
 * host, which attaches its handler before its first await.
 */
// Straight to the assembly, not through the package barrel: the barrel also
// publishes the pack-time transform, whose acorn dependency would then be bundled
// into this worker — which never parses JavaScript.
import { createWorkerHost } from './worker-host.ts'
import './node/builtin_modules/implemented/buffer.ts'
import { alsCausality, runAtAsyncContextRoot } from './node/builtin_modules/implemented/async_hooks.ts'
import { installAsyncContextHooks } from './polyfill/async-context/async-context-hooks.ts'
import { createNodeBuiltins, REPLACED_PREFIXES } from './node/builtins.ts'
import { whenRequestListener } from './node/builtin_modules/implemented/http.ts'
import { installTimerGlobals } from './node/globals/timers.ts'
import { installProcessGlobal } from './node/globals/process.ts'
import { installCryptoGlobals } from './node/globals/crypto.ts'
import { isShellStartFrame } from './shell/process/protocol.ts'
import { runShellProcess } from './shell/process/host.ts'

// Before the timer globals, so the wrappers close over the patched platform.
installAsyncContextHooks()
installTimerGlobals()
installCryptoGlobals()

let host: { handleMessage(data: unknown): void } | undefined
let shellRole = false
const pending: unknown[] = []

self.addEventListener('message', (event: MessageEvent) => {
  const data = event.data as Record<string, unknown> | null
  // Role, decided by the first frame: a worker started by the host's shell
  // runs one command and closes. It mounts no image and boots no tree, so the
  // whole assembly below never happens in it.
  if (host === undefined && isShellStartFrame(data)) {
    shellRole = true
    // The command's own directory and environment are the only `process` facts
    // a shell process needs; bundled code that reads the global (picomatch's
    // platform check) must not find it missing.
    installProcessGlobal({ cwd: data.cwd, env: data.env })
    runShellProcess(data, self)
    return
  }
  if (host === undefined && data !== null && typeof data === 'object' && data.t === 'init') {
    if (typeof data.image !== 'string') {
      throw new Error('webworker: init frame needs a string image url')
    }
    if (!Array.isArray(data.overlays) || data.overlays.some(overlay => typeof overlay !== 'string')) {
      throw new Error('webworker: init frame needs an array of string overlay urls')
    }
    const created = createWorkerHost({
      staticModules: createNodeBuiltins(),
      staticModulePrefixes: REPLACED_PREFIXES,
      requestListener: whenRequestListener,
      alsCausality,
      image: data.image,
      overlays: data.overlays as string[],
    })
    host = created
    for (const queued of pending) {
      runAtAsyncContextRoot(() => { created.handleMessage(queued) })
    }
    pending.length = 0
    created.start().catch(() => {
      // start() already reported the failure to the page through tunnel.fail;
      // nothing else can reach this rejection, so only the duplicate
      // unhandled-rejection noise is dropped here.
    })
    return
  }
  if (host === undefined) {
    // A shell-role worker's later frames (fs replies, signals) belong to
    // runShellProcess's own listener; parking them here would hold every
    // file body until the worker exits.
    if (shellRole) return
    pending.push(event.data)
    return
  }
  const ready = host
  // A tunnel request belongs to no boundary: dispatch it at the context root so
  // it cannot inherit whatever ran just before it on this thread.
  runAtAsyncContextRoot(() => { ready.handleMessage(event.data) })
})
