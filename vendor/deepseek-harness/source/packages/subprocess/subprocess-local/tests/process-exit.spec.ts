import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

function isRunning(pid: number): boolean {
  try { process.kill(pid, 0) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false
    throw error
  }
  if (process.platform === 'linux') {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
      return !/^[ZXx]$/.test(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[0] ?? '')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
      throw error
    }
  }
  return true
}

it.each(['direct', 'uncaught-exception', 'unhandled-rejection', 'dispose'] as const)(
  'stops the owned process tree on %s and releases only owned listeners', async (trigger) => {
    const root = mkdtempSync(join(tmpdir(), 'youdub-process-exit-'))
    const fixture = fileURLToPath(new URL('./fixtures/process-exit-host.ts', import.meta.url))
    const host = spawn(process.execPath, [fixture, trigger, root], { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    let failure: Error | undefined
    let exited: { code: number | null; signal: NodeJS.Signals | null } | undefined
    let tree: { root: number; descendant: number } | undefined
    host.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
    host.on('error', error => { failure = error })
    host.on('exit', (code, signal) => { exited = { code, signal } })
    try {
      const treePath = join(root, 'tree.json')
      await expect.poll(() => {
        if (failure) throw failure
        if (exited) throw new Error(`fixture exited before creating its tree: ${stderr}`)
        return existsSync(treePath)
      }, { timeout: 10_000 }).toBe(true)
      tree = JSON.parse(readFileSync(treePath, 'utf8')) as typeof tree
      expect(tree).toEqual({ root: expect.any(Number), descendant: expect.any(Number) })
      writeFileSync(join(root, 'proceed'), '')
      await expect.poll(() => exited, { timeout: 10_000 }).toEqual({
        code: trigger === 'dispose' ? 0 : trigger === 'direct' ? 23 : 1,
        signal: null,
      })
      await expect.poll(() => [isRunning(tree!.root), isRunning(tree!.descendant)], { timeout: 5_000 }).toEqual([false, false])
      if (trigger === 'dispose') {
        expect(JSON.parse(readFileSync(join(root, 'dispose.json'), 'utf8'))).toEqual({
          ownedListenersAfterLoad: 1,
          ownedListenersAfterDispose: 0,
          unrelatedListenerPreserved: true,
        })
      } else if (trigger !== 'direct') expect(stderr).toContain(`host-exit-${trigger}`)
    } finally {
      for (const pid of [tree?.descendant, tree?.root, host.pid]) {
        if (pid !== undefined && isRunning(pid)) process.kill(pid, 'SIGKILL')
      }
      rmSync(root, { recursive: true, force: true })
    }
  }, 30_000,
)
