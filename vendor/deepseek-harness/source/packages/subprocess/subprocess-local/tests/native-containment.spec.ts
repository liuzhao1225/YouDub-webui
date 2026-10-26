import { spawn } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { launchLinuxScope, probeLinuxScope } from '../src/linux-scope.ts'
import { targetEnvironment } from '../src/runner-launch.ts'
import { bindManagedProcess } from '../src/spawn.ts'

const scratch = mkdtempSync(join(tmpdir(), 'dsh-native-containment-'))
afterAll(() => { rmSync(scratch, { recursive: true, force: true }) })

function spec(argv: string[], graceMs = 100): SubprocessSpawnSpec {
  return {
    argv,
    cwd: scratch,
    stdio: {
      stdin: 'ignore',
      stdout: { maxBytes: 64_000 },
      stderr: { maxBytes: 64_000 },
    },
    graceMs,
  }
}

type SpawnFailure = NodeJS.ErrnoException & { path?: string }

function directSpawnFailure(argv: readonly string[]): Promise<SpawnFailure> {
  return new Promise((resolve, reject) => {
    const child = spawn(argv[0] as string, argv.slice(1), { cwd: scratch, stdio: 'ignore' })
    child.once('error', resolve)
    child.once('spawn', () => { reject(new Error(`expected ${argv[0]} to fail before spawn`)) })
  })
}

async function waitForPid(path: string): Promise<number> {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    try {
      const pid = Number(readFileSync(path, 'utf8').trim())
      if (Number.isSafeInteger(pid) && pid > 0) return pid
    } catch {
      // The target has not written the file yet.
    }
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error(`pid file ${path} was not written`)
}

async function waitGone(pid: number): Promise<void> {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0)
      try {
        const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
        const state = stat.slice(stat.lastIndexOf(')') + 2, stat.lastIndexOf(')') + 3)
        if (state === 'Z' || state === 'X') return
      } catch {
        return
      }
    } catch {
      return
    }
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error(`pid ${pid} remained alive`)
}

const literalArgv = process.platform === 'linux' ? probeLinuxScope() : undefined

describe.skipIf(literalArgv === undefined)('Linux user-systemd native containment', () => {
  const scopeOptions = literalArgv ?? []

  it('aborts an established scope before bootstrap consumption and joins its managed handle', async () => {
    const controller = new AbortController()
    const request: SubprocessSpawnSpec = {
      ...spec(['bash', '-c', 'exit 0']),
      signal: controller.signal,
      stdio: { stdin: 'pipe', stdout: { maxBytes: 1_024 }, stderr: { maxBytes: 1_024 } },
    }
    const handle = bindManagedProcess(request, launchLinuxScope(request, targetEnvironment(request), scopeOptions, {
      runnerInvocation: [process.execPath, join(import.meta.dirname, 'fixtures/hold-linux-bootstrap.ts')],
    }))
    try {
      const deadline = Date.now() + 5_000
      while (!handle.collected.stdout?.readFrom(0).text.includes('BOOTSTRAP_WAITING')) {
        if (Date.now() >= deadline) throw new Error('bootstrap did not reach its input barrier')
        await new Promise(resolve => setTimeout(resolve, 20))
      }
      controller.abort(new Error('cancel before target execution'))
      await expect(handle.done).resolves.toEqual({ exitCode: null, signal: 'SIGTERM' })
      await expect(handle.waitForExit()).resolves.toBe(true)
    } finally {
      handle.terminate()
      await Promise.allSettled([handle.done, handle.waitForExit()])
    }
  })

  it('terminates a setsid descendant and waits for the scope to become empty', async () => {
    const pidFile = join(scratch, `setsid-${Date.now()}.pid`)
    const command = `setsid sh -c 'echo $$ > "$1"; trap "" TERM; while :; do sleep 60; done' sh ${JSON.stringify(pidFile)} & wait`
    const request = spec(['bash', '-c', command], 80)
    const handle = bindManagedProcess(request, launchLinuxScope(request, targetEnvironment(request), scopeOptions))
    let descendant: number | undefined
    try {
      descendant = await waitForPid(pidFile)
      handle.terminate()
      await handle.done
      await expect(handle.waitForExit()).resolves.toBe(true)
      await waitGone(descendant)
    } finally {
      handle.terminate()
      await Promise.allSettled([handle.done, handle.waitForExit()])
      if (descendant !== undefined) {
        try { process.kill(descendant, 'SIGKILL') } catch { /* already contained */ }
      }
    }
  })

  it('preserves Node-shaped ENOENT and EACCES spawn failures without replay', async () => {
    const missingArgv = [`missing-native-target-${Date.now()}`, 'literal arg']
    const expectedMissing = await directSpawnFailure(missingArgv)
    const missing = spec(missingArgv)
    const missingHandle = bindManagedProcess(missing, launchLinuxScope(missing, targetEnvironment(missing), scopeOptions))
    await expect(missingHandle.done).rejects.toMatchObject({
      name: expectedMissing.name,
      message: expectedMissing.message,
      code: expectedMissing.code,
      syscall: expectedMissing.syscall,
      path: expectedMissing.path,
    })

    const deniedPath = join(scratch, `not-executable-${Date.now()}`)
    writeFileSync(deniedPath, '#!/bin/sh\nexit 0\n', { mode: 0o600 })
    chmodSync(deniedPath, 0o600)
    const deniedArgv = [deniedPath, 'literal arg']
    const expectedDenied = await directSpawnFailure(deniedArgv)
    const denied = spec(deniedArgv)
    const deniedHandle = bindManagedProcess(denied, launchLinuxScope(denied, targetEnvironment(denied), scopeOptions))
    await expect(deniedHandle.done).rejects.toMatchObject({
      name: expectedDenied.name,
      message: expectedDenied.message,
      code: expectedDenied.code,
      syscall: expectedDenied.syscall,
      path: expectedDenied.path,
    })
  })
})
