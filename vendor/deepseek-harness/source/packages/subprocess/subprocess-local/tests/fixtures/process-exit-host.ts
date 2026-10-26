import { access, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'

const [trigger, root] = process.argv.slice(2)
if ((trigger !== 'direct' && trigger !== 'uncaught-exception'
    && trigger !== 'unhandled-rejection' && trigger !== 'dispose')
  || root === undefined) {
  throw new Error('usage: process-exit-host.ts <direct|uncaught-exception|unhandled-rejection|dispose> <root>')
}

const treeState = join(root, 'tree.json')
const proceed = join(root, 'proceed')
const managedTree = fileURLToPath(new URL('./managed-tree.ts', import.meta.url))

async function waitForFile(path: string): Promise<void> {
  for (;;) {
    try {
      await access(path)
      return
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      await new Promise(resolve => setTimeout(resolve, 10))
    }
  }
}

const listenersBefore = new Set(process.listeners('exit'))
const ctx = new Context()
const fiber = await ctx.plugin(LocalSubprocessRuntime)
const ownedListeners = process.listeners('exit').filter(listener => !listenersBefore.has(listener))
// Independent process-lifetime listeners may be installed after this provider.
const unrelatedListener = (): void => {}
if (trigger === 'dispose') process.once('exit', unrelatedListener)
const child = ctx.subprocess.spawn({
  argv: [process.execPath, managedTree, treeState],
  cwd: process.cwd(),
  stdio: {
    stdin: 'ignore',
    stdout: { maxBytes: 1024 },
    stderr: { maxBytes: 1024 },
  },
  graceMs: trigger === 'dispose' ? 100 : 30_000,
})
const prematureExit = child.done.then(outcome => {
  throw new Error(`managed tree exited before the host trigger: ${JSON.stringify(outcome)}; ${child.collected.stderr?.readFrom(0).text ?? ''}`)
})

await Promise.race([waitForFile(treeState), prematureExit])
const published = JSON.parse(await readFile(treeState, 'utf8')) as { root?: unknown; descendant?: unknown }
if (!Number.isSafeInteger(published.root) || !Number.isSafeInteger(published.descendant)) {
  throw new Error('managed tree published invalid process ids')
}
await Promise.race([waitForFile(proceed), prematureExit])

if (trigger === 'dispose') {
  await fiber.dispose()
  await writeFile(join(root, 'dispose.json'), JSON.stringify({
    ownedListenersAfterLoad: ownedListeners.length,
    ownedListenersAfterDispose: ownedListeners.filter(listener => process.listeners('exit').includes(listener)).length,
    unrelatedListenerPreserved: process.listeners('exit').includes(unrelatedListener),
  }))
} else if (trigger === 'direct') {
  process.exit(23)
} else if (trigger === 'uncaught-exception') {
  setImmediate(() => { throw new Error('host-exit-uncaught-exception') })
  await new Promise(() => {})
} else {
  void Promise.reject(new Error('host-exit-unhandled-rejection'))
  await new Promise(() => {})
}
