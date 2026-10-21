/**
 * Starting and supervising shell processes from the host worker.
 *
 * A process is a Web Worker started from this same bundle, told by its first
 * frame to be a shell process rather than a host. That is what buys real
 * process semantics in a browser: the command runs off the host's thread, and
 * `terminate()` stops it even mid-loop — the one thing a cooperative in-thread
 * interpreter can never do.
 *
 * Where no `Worker` constructor exists (a Node test host), the same command
 * runs inline on this thread. Everything except preemption behaves the same,
 * and the difference is named rather than hidden: {@link RunningProcess.destroy}
 * can only ask an inline command to stop.
 * @module @deepseek-ai/dsh-experimental-webworker-runtime/src/shell/process/host
 */

import { runShellCommand, runShellProgram } from '../interpret.ts'
import { hostFileSystem } from '../fs-access.ts'
import type { ShellFileSystem } from '../types.ts'
import type { FilesystemOperation, FromProcessFrame, ShellStartFrame } from './protocol.ts'
import { runShellProcess } from './child.ts'
import type { ProcessScope } from './child.ts'

/** What the caller must supply to start one process. */
export interface ProcessStartOptions {
  /** Command source for `bash -c`, or undefined when `argv` names a program. */
  script?: string | undefined
  /** The program and its arguments. */
  argv: readonly string[]
  /** Working directory the command starts in. */
  cwd: string
  /** Environment the command starts with. */
  env: Record<string, string>
  /** Everything on standard input. */
  stdin: string
  /** Receives output as it is produced. */
  onOutput: (stream: 'stdout' | 'stderr', text: string) => void
  /** Receives the settled status exactly once. */
  onExit: (code: number) => void
  /** The filesystem the command acts on; defaults to the mounted VFS. */
  fs?: ShellFileSystem | undefined
}

/** A started command, from the host's side. */
export interface RunningProcess {
  /** Ask the command to stop at its next command boundary (the `SIGTERM` rung). */
  interrupt(): void
  /**
   * Stop the command now (the `SIGKILL` rung). A worker-backed process dies
   * whatever it was doing; an inline one can only be asked, because nothing
   * can preempt a synchronous loop on its own thread.
   */
  destroy(): void
}

/** Whether this thread can start a real process worker. */
function canSpawnWorker(): boolean {
  return typeof Worker === 'function' && typeof self !== 'undefined' && typeof self.location.href === 'string'
}

/**
 * Start one command.
 * @param options - the command, its environment, and the sinks for its output and status.
 * @returns the handle the process table signals through.
 */
export function startProcess(options: ProcessStartOptions): RunningProcess {
  return canSpawnWorker() ? startWorkerProcess(options) : startInlineProcess(options)
}

/** Serve one filesystem call for a process worker. */
async function serveFilesystemCall(fs: ShellFileSystem, op: FilesystemOperation, args: readonly unknown[]): Promise<unknown> {
  switch (op) {
    case 'stat': return await fs.stat(args[0] as string)
    case 'list': return await fs.list(args[0] as string)
    case 'readText': return await fs.readText(args[0] as string)
    case 'writeText':
      await fs.writeText(args[0] as string, args[1] as string, args[2] as boolean)
      return undefined
    case 'mkdir':
      await fs.mkdir(args[0] as string, args[1] as boolean)
      return undefined
    case 'remove':
      await fs.remove(args[0] as string, args[1] as { recursive: boolean; force: boolean })
      return undefined
    case 'rename':
      await fs.rename(args[0] as string, args[1] as string)
      return undefined
    default:
      // The op crossed a worker postMessage: a name the union does not carry
      // must fail the call rather than answer `{ value: undefined }`.
      throw new Error(`webworker shell: unknown filesystem op ${String(op)}`)
  }
}

/** The worker-backed process: a second copy of this bundle, running one command. */
function startWorkerProcess(options: ProcessStartOptions): RunningProcess {
  const fs = options.fs ?? hostFileSystem()
  // Same bundle, different role: the first frame decides. Starting from this
  // worker's own URL keeps the deployment free of a second static asset and of
  // the build-order trap a sibling artifact would bring.
  const worker = new Worker(self.location.href, { type: 'module' })
  let settled = false
  const settle = (code: number): void => {
    if (settled) return
    settled = true
    worker.terminate()
    options.onExit(code)
  }

  worker.addEventListener('message', (event: MessageEvent) => {
    const frame = event.data as FromProcessFrame
    if (frame.t === 'shell-out') {
      options.onOutput(frame.stream, frame.text)
      return
    }
    if (frame.t === 'shell-exit') {
      settle(frame.code)
      return
    }
    void serveFilesystemCall(fs, frame.op, frame.args).then(
      (value) => { worker.postMessage({ t: 'fs-reply', id: frame.id, value }) },
      (error: unknown) => {
        const failure = {
          code: (error as { code?: string }).code,
          message: error instanceof Error ? error.message : String(error),
        }
        worker.postMessage({ t: 'fs-reply', id: frame.id, failure })
      },
    )
  })
  worker.addEventListener('error', (event: ErrorEvent) => {
    options.onOutput('stderr', `bash: process worker failed: ${event.message}\n`)
    settle(1)
  })

  const start: ShellStartFrame = {
    t: 'shell-start',
    script: options.script,
    argv: options.argv,
    cwd: options.cwd,
    env: options.env,
    stdin: options.stdin,
  }
  worker.postMessage(start)

  return {
    interrupt: () => { if (!settled) worker.postMessage({ t: 'shell-signal' }) },
    // The reason this whole module exists: a worker dies on command, even
    // mid-loop, so a timeout is enforceable rather than advisory.
    destroy: () => { settle(130) },
  }
}

/** The inline process: the same command on this thread, stoppable only by asking. */
function startInlineProcess(options: ProcessStartOptions): RunningProcess {
  const stopping = new AbortController()
  const runOptions = {
    cwd: options.cwd,
    env: options.env,
    stdin: options.stdin,
    signal: stopping.signal,
    fs: options.fs ?? hostFileSystem(),
    onOutput: options.onOutput,
  }
  const run = options.script === undefined
    ? runShellProgram(options.argv, runOptions)
    : runShellCommand(options.script, runOptions)
  void run.then(
    (outcome) => { options.onExit(outcome.exitCode) },
    (error: unknown) => {
      options.onOutput('stderr', `bash: ${String(error)}\n`)
      options.onExit(1)
    },
  )
  const stop = (): void => { stopping.abort(new Error('killed by signal')) }
  return { interrupt: stop, destroy: stop }
}

/** Re-exported for the worker entry, which decides its role from the first frame. */
export { runShellProcess }
export type { ProcessScope }
