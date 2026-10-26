import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import type { SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { childEnv } from '../src/spawn.ts'
import { LinuxScopeNotStartedError, signalLinuxDirectProcess } from '../src/linux-scope.ts'

function mockWin32ForIsolatedRuntime(): void {
  vi.doMock('@deepseek-ai/dsh-win32-process', () => ({
    loadWin32ProcessBindings: vi.fn(),
    probeCurrentTokenJobSupport: vi.fn(),
  }))
}

function unmockWin32ForIsolatedRuntime(): void {
  vi.doUnmock('@deepseek-ai/dsh-win32-process')
}

function spec(command: string, overrides: Partial<SubprocessSpawnSpec> = {}): SubprocessSpawnSpec {
  // Windows has no bash; the suite's simple commands translate to node one-liners.
  const argv = process.platform === 'win32'
    ? [process.execPath, '-e', {
      'echo managed': 'console.log("managed")',
      'sleep 60': 'setTimeout(() => {}, 60000)',
      'true': '',
    }[command] ?? command]
    : ['bash', '-c', command]
  return {
    argv,
    cwd: process.cwd(),
    stdio: {
      stdin: 'ignore',
      stdout: { maxBytes: 64_000, spill: { maxBytes: 64 * 1024 * 1024 } },
      stderr: { maxBytes: 64_000, spill: { maxBytes: 64 * 1024 * 1024 } },
    },
    graceMs: 200,
    ...overrides,
  }
}

describe('LocalSubprocessRuntime', () => {
  it('places the host-exit finalizer before listeners that predate the service', async () => {
    const baseline = new Set(process.listeners('exit'))
    const prior = vi.fn()
    process.on('exit', prior)
    const ctx = new Context()
    const fiber = await ctx.plugin(LocalSubprocessRuntime)
    try {
      const listeners = process.listeners('exit')
      const finalizer = listeners.find(candidate => !baseline.has(candidate) && candidate !== prior)
      expect(finalizer).toBeTypeOf('function')
      expect(listeners.indexOf(finalizer!)).toBeLessThan(listeners.indexOf(prior))
    } finally {
      process.off('exit', prior)
      await fiber.dispose()
    }
  })

  it('keeps the host-exit finalizer active until normal disposal reaches quiescence', async () => {
    const before = new Set(process.listeners('exit'))
    const ctx = new Context()
    const fiber = await ctx.plugin(LocalSubprocessRuntime)
    const listener = process.listeners('exit').find(candidate => !before.has(candidate))
    expect(listener).toBeTypeOf('function')

    let finishExit!: () => void
    const exited = new Promise<void>((resolve) => { finishExit = resolve })
    const terminate = vi.fn()
    const terminateForHostExit = vi.fn()
    const live = (ctx.subprocess as unknown as {
      live: Set<{
        done: Promise<{ exitCode: number; signal: null }>
        terminate(): void
        terminateForHostExit(): void
        waitForExit(): Promise<boolean>
      }>
    }).live
    live.add({
      done: Promise.resolve({ exitCode: 0, signal: null }),
      terminate,
      terminateForHostExit,
      waitForExit: async () => { await exited; return true },
    })

    let disposed = false
    const disposing = fiber.dispose().then(() => { disposed = true })
    await new Promise(resolve => setImmediate(resolve))
    expect(disposed).toBe(false)
    expect(live.size).toBe(1)
    listener?.(0)
    expect(terminate).toHaveBeenCalledOnce()
    expect(terminateForHostExit).toHaveBeenCalledOnce()

    finishExit()
    await disposing
    expect(live.size).toBe(0)
    expect(process.listeners('exit')).not.toContain(listener)
  })

  it('observes range failure without waiting for a stuck direct result', async () => {
    const before = new Set(process.listeners('exit'))
    const ctx = new Context()
    const disposalErrors: unknown[] = []
    ctx.logger.error = ((error: unknown) => { disposalErrors.push(error) }) as typeof ctx.logger.error
    const fiber = await ctx.plugin(LocalSubprocessRuntime)
    const listener = process.listeners('exit').find(candidate => !before.has(candidate))
    const rangeFailure = new Error('managed range became unreadable')
    const terminate = vi.fn()
    const terminateForHostExit = vi.fn()
    const live = (ctx.subprocess as unknown as {
      live: Set<{
        done: Promise<never>
        terminate(): void
        terminateForHostExit(): void
        waitForExit(): Promise<boolean>
      }>
    }).live
    live.add({
      done: new Promise<never>(() => {}),
      terminate,
      terminateForHostExit,
      waitForExit: async () => { throw rangeFailure },
    })

    await expect(Promise.race([
      fiber.dispose().then(() => 'disposed'),
      new Promise<string>(resolve => setTimeout(() => { resolve('timeout') }, 100)),
    ])).resolves.toBe('disposed')
    expect(terminate).toHaveBeenCalledOnce()
    expect(terminateForHostExit).toHaveBeenCalledOnce()
    expect(disposalErrors).toEqual([rangeFailure])
    expect(live.size).toBe(1)
    expect(process.listeners('exit')).toContain(listener)
    listener?.(0)
    expect(terminateForHostExit).toHaveBeenCalledTimes(2)
    if (listener !== undefined) process.off('exit', listener)
  })

  it('contains each host-exit termination failure and continues with the other targets', async () => {
    const before = new Set(process.listeners('exit'))
    const ctx = new Context()
    const fiber = await ctx.plugin(LocalSubprocessRuntime)
    const listener = process.listeners('exit').find(candidate => !before.has(candidate))
    expect(listener).toBeTypeOf('function')
    const ordinaryFailure = vi.fn(() => { throw new Error('ordinary failed') })
    const ordinarySuccess = vi.fn()
    const service = ctx.subprocess as unknown as {
      live: Set<{ terminateForHostExit(): void }>
    }
    service.live.add({ terminateForHostExit: ordinaryFailure })
    service.live.add({ terminateForHostExit: ordinarySuccess })

    expect(() => { listener?.(0) }).not.toThrow()
    expect(ordinaryFailure).toHaveBeenCalledOnce()
    expect(ordinarySuccess).toHaveBeenCalledOnce()

    service.live.clear()
    await fiber.dispose()
  })

  it('resolves absolute and PATH executables and honors lookup cancellation', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(LocalSubprocessRuntime)
    expect(await ctx.subprocess.resolveExecutable(process.execPath)).toBe(process.execPath)
    expect(await ctx.subprocess.resolveExecutable(basename(process.execPath), {
      PATH: dirname(process.execPath),
    })).toBe(process.execPath)
    expect(await ctx.subprocess.resolveExecutable(basename(process.execPath), {
      PATH: relative(process.cwd(), dirname(process.execPath)) || '.',
    })).toBe(process.execPath)
    await expect(ctx.subprocess.resolveExecutable('')).rejects.toThrow('must be non-empty')
    await expect(ctx.subprocess.resolveExecutable('./bin/tsserver'))
      .rejects.toThrow('is a relative path')
    await expect(ctx.subprocess.resolveExecutable('node_modules/.bin/server'))
      .rejects.toThrow('is a relative path')
    await expect(ctx.subprocess.resolveExecutable('dsh-command-that-does-not-exist', { PATH: '' }))
      .rejects.toThrow('was not found on PATH')
    await expect(ctx.subprocess.resolveExecutable('/dsh-absolute-command-that-does-not-exist'))
      .rejects.toThrow('is not an executable file')
    await expect(ctx.subprocess.resolveExecutable(process.cwd()))
      .rejects.toThrow('is not an executable file')
    await expect(ctx.subprocess.resolveExecutable(process.execPath, {}, AbortSignal.abort('stop')))
      .rejects.toBe('stop')
    await fiber.dispose()
  })

  it('builds Windows executable candidates with case-insensitive overrides', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(LocalSubprocessRuntime)
    const service = ctx.subprocess as LocalSubprocessRuntime
    const candidates = (service as unknown as {
      executableCandidates(command: string, env: NodeJS.ProcessEnv): string[]
    }).executableCandidates.bind(service)
    const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    try {
      expect(Object.keys(childEnv()).filter(key => key.toUpperCase() === 'PATH')).toHaveLength(1)
      const explicit = childEnv({ Path: '/bin', PathExt: '.EXE;.CMD' })
      expect(Object.keys(explicit).filter(key => key.toUpperCase() === 'PATH')).toEqual(['Path'])
      expect(Object.keys(explicit).filter(key => key.toUpperCase() === 'PATHEXT')).toEqual(['PathExt'])
      expect(candidates('tool', explicit)).toEqual([resolve('/bin', 'tool.EXE'), resolve('/bin', 'tool.CMD')])
      expect(candidates('tool', { Path: '/ambient', PATH: '/explicit', PATHEXT: '.EXE' }))
        .toEqual([resolve('/explicit', 'tool.EXE')])
      expect(candidates('tool.exe', {})).toEqual([resolve(process.cwd(), 'tool.exe')])
      expect(candidates('tool', { PATH: '/bin' })).toHaveLength(4)
      await expect(ctx.subprocess.resolveExecutable(String.raw`bin\server.exe`))
        .rejects.toThrow('is a relative path')
    } finally {
      platform.mockRestore()
      await fiber.dispose()
    }
  })

  it('registers as ctx.subprocess and spawns managed handles', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(LocalSubprocessRuntime)
    const handle = ctx.subprocess.spawn(spec('echo managed'))
    expect(handle).not.toHaveProperty('pid')
    const result = await handle.done
    expect(result.exitCode).toBe(0)
    expect(handle.collected.stdout!.readFrom(0).text).toBe('managed\n')
    await fiber.dispose()
  })

  it('logs one error through the plugin logger when a spill cannot be written and keeps the tail', async () => {
    const removedDir = mkdtempSync(join(tmpdir(), 'dsh-subprocess-removed-'))
    rmSync(removedDir, { recursive: true, force: true })
    const ctx = new Context()
    const logged = vi.spyOn(ctx.logger, 'error').mockImplementation(() => {})
    const fiber = await ctx.plugin(LocalSubprocessRuntime)
    const runtime = ctx.subprocess as LocalSubprocessRuntime
    runtime.internals = { spillDir: removedDir }
    try {
      const handle = runtime.spawn(spec('', {
        argv: [process.execPath, '-e', 'process.stdout.write("x".repeat(4096))'],
        stdio: { stdin: 'ignore', stdout: { maxBytes: 16, spill: { maxBytes: 1_000_000 } }, stderr: 'pipe' },
      }))
      const result = await handle.done
      expect(result.exitCode).toBe(0)
      const stdout = handle.collected.stdout!.readFrom(0)
      expect(stdout.text).toBe('x'.repeat(16))
      expect(stdout.lossy).toBe(true)
      expect(stdout.spillPath).toBeUndefined()
      expect(logged).toHaveBeenCalledOnce()
      const [message, error] = logged.mock.calls[0] as [string, NodeJS.ErrnoException]
      expect(message).toContain('could not write the complete stdout stream')
      expect(message).toContain('temporary-file cleaner')
      expect(error.code).toBe('ENOENT')
    } finally {
      await fiber.dispose()
    }
  })

  it('warns once when ordinary spawns use the weaker macOS fallback', async () => {
    const ctx = new Context()
    const warning = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    const fiber = await ctx.plugin(LocalSubprocessRuntime)
    const runtime = ctx.subprocess as LocalSubprocessRuntime
    runtime.internals = { platform: 'darwin' }
    try {
      const first = runtime.spawn(spec('true'))
      const second = runtime.spawn(spec('true'))
      await Promise.all([first.done, second.done])
      expect(warning).toHaveBeenCalledOnce()
      expect(warning).toHaveBeenCalledWith(
        expect.stringContaining('descendants that escape the process group'),
      )
    } finally {
      warning.mockRestore()
      await fiber.dispose()
    }
  })

  it('reports the platform-specific reason for every fallback mode', async () => {
    for (const [platform, reason, selectedReason] of [
      ['darwin', 'macOS has no supported persistent process-range owner', undefined],
      ['linux', 'the private Linux subprocess runner is unavailable', 'the private Linux subprocess runner is unavailable'],
      ['win32', 'the Win32 Job runner is unavailable', undefined],
      ['freebsd', 'platform freebsd has no native managed range', undefined],
    ] as const) {
      const ctx = new Context()
      const warning = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
      const fiber = await ctx.plugin(LocalSubprocessRuntime)
      const runtime = ctx.subprocess as unknown as {
        warnFallback(platform: NodeJS.Platform, selectedReason?: string): void
      }
      try {
        runtime.warnFallback(platform, selectedReason)
        expect(warning).toHaveBeenLastCalledWith(
          expect.stringContaining(reason),
        )
      } finally {
        warning.mockRestore()
        await fiber.dispose()
      }
    }
  })

  it('probes Linux native support once, confirms the user manager and rechecks the Windows Job per spawn, and prepares storage before launch', async () => {
    const linuxLaunch = { kind: 'linux' }
    const windowsLaunch = { kind: 'windows' }
    const launchLinuxScope = vi.fn(() => linuxLaunch)
    const launchWindowsJob = vi.fn(() => windowsLaunch)
    const probeLinuxNative = vi.fn((): string[] => [])
    const confirmLinuxManager = vi.fn()
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false)
    const probeWindowsJob = vi.fn(() => true)
    const prepareManagedProcessBinding = vi.fn(() => ({ spillDir: '/tmp/dsh-test-spill' }))
    const handles = [true, false, false, false].map((failFirstWait) => {
      let waits = 0
      return {
        collected: {},
        done: Promise.resolve({ exitCode: 0, signal: null }),
        terminate: vi.fn(),
        terminateForHostExit: vi.fn(),
        waitForExit: vi.fn(async () => {
          waits += 1
          if (failFirstWait && waits === 1) throw new Error('release observation failed')
          return true
        }),
      }
    })
    const bindManagedProcess = vi.fn((_spec: unknown, _launch: unknown, _binding: unknown) => {
      const handle = handles.shift()
      if (handle === undefined) throw new Error('missing fake handle')
      return handle
    })
    const spawnSubprocess = vi.fn(() => ({
      collected: {},
      done: Promise.resolve({ exitCode: 0, signal: null }),
      terminate: vi.fn(),
      terminateForHostExit: vi.fn(),
      waitForExit: vi.fn(async () => true),
    }))

    vi.resetModules()
    mockWin32ForIsolatedRuntime()
    vi.doMock('../src/linux-scope.ts', () => ({
      confirmLinuxManager,
      LinuxScopeNotStartedError,
      linuxManagerListener: vi.fn(() => undefined),
      systemdRunIdentity: vi.fn(() => 'launcher'),
      signalLinuxDirectProcess,
      launchLinuxScope,
      probeLinuxNative,
    }))
    vi.doMock('../src/windows-job.ts', () => ({ launchWindowsJob, probeWindowsJob }))
    vi.doMock('../src/spawn.ts', async importOriginal => ({
      ...await importOriginal<typeof import('../src/spawn.ts')>(),
      bindManagedProcess,
      spawnSubprocess,
    }))
    vi.doMock('../src/output.ts', async importOriginal => ({
      ...await importOriginal<typeof import('../src/output.ts')>(), prepareManagedProcessBinding,
    }))
    const fibers: Array<{ dispose(): Promise<void> }> = []
    try {
      const { default: IsolatedLocalSubprocessRuntime } = await import('../src/index.ts')
      const linuxContext = new Context()
      const warn = vi.spyOn(linuxContext.logger, 'warn').mockImplementation(() => {})
      const linuxFiber = await linuxContext.plugin(IsolatedLocalSubprocessRuntime)
      fibers.push(linuxFiber)
      const linuxRuntime = linuxContext.subprocess as InstanceType<typeof IsolatedLocalSubprocessRuntime>
      linuxRuntime.internals = { platform: 'linux' }
      const preparationFailure = new Error('spill directory unavailable')
      prepareManagedProcessBinding.mockImplementationOnce(() => { throw preparationFailure })
      expect(() => linuxRuntime.spawn(spec('true'))).toThrow(preparationFailure)
      expect(launchLinuxScope).not.toHaveBeenCalled()
      await linuxRuntime.spawn(spec('true')).done
      await new Promise(resolve => setImmediate(resolve))
      await linuxRuntime.spawn(spec('true')).done
      await new Promise(resolve => setImmediate(resolve))
      expect(probeLinuxNative).toHaveBeenCalledOnce()
      expect(confirmLinuxManager).toHaveBeenCalledTimes(2)
      expect(launchLinuxScope).toHaveBeenCalledTimes(2)
      expect(launchLinuxScope).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), [])
      await linuxRuntime.spawn(spec('true')).done
      expect(confirmLinuxManager).toHaveBeenCalledTimes(3)
      expect(spawnSubprocess).toHaveBeenCalledOnce()
      expect(warn).toHaveBeenCalledOnce()

      const windowsContext = new Context()
      const windowsFiber = await windowsContext.plugin(IsolatedLocalSubprocessRuntime)
      fibers.push(windowsFiber)
      const windowsRuntime = windowsContext.subprocess as InstanceType<typeof IsolatedLocalSubprocessRuntime>
      windowsRuntime.internals = { platform: 'win32' }
      await windowsRuntime.spawn(spec('true')).done
      await new Promise(resolve => setImmediate(resolve))
      await windowsRuntime.spawn(spec('true')).done
      await new Promise(resolve => setImmediate(resolve))
      expect(probeWindowsJob).toHaveBeenCalledTimes(2)
      expect(launchWindowsJob).toHaveBeenCalledTimes(2)
      expect(bindManagedProcess.mock.calls.map(([, launch]) => launch)).toEqual([
        linuxLaunch,
        linuxLaunch,
        windowsLaunch,
        windowsLaunch,
      ])
      expect(prepareManagedProcessBinding).toHaveBeenCalledTimes(5)
      expect(spawnSubprocess).toHaveBeenCalledOnce()
    } finally {
      for (const fiber of fibers.reverse()) await fiber.dispose()
      vi.doUnmock('../src/linux-scope.ts')
      vi.doUnmock('../src/windows-job.ts')
      vi.doUnmock('../src/spawn.ts')
      vi.doUnmock('../src/output.ts')
      unmockWin32ForIsolatedRuntime()
      vi.resetModules()
    }
  })

  it('routes Linux scope decisions into launches and probes again after a scope never starts', async () => {
    const probeLinuxNative = vi.fn<() => string[] | undefined>()
      .mockReturnValueOnce([])
      .mockReturnValueOnce(undefined)
    const launchLinuxScope = vi.fn((_spec: unknown, _env: unknown, _literalArgv: readonly string[]) => ({ kind: 'linux' }))
    const scopeOutcomes: Array<PromiseWithResolvers<{ exitCode: number; signal: null }>> = []
    const fakeHandle = (done: Promise<{ exitCode: number; signal: null }>) => ({
      collected: {},
      done,
      terminate: vi.fn(),
      terminateForHostExit: vi.fn(),
      waitForExit: vi.fn(async () => true),
    })
    const bindManagedProcess = vi.fn(() => {
      const outcome = Promise.withResolvers<{ exitCode: number; signal: null }>()
      scopeOutcomes.push(outcome)
      return fakeHandle(outcome.promise)
    })
    const spawnSubprocess = vi.fn(() => fakeHandle(Promise.resolve({ exitCode: 0, signal: null })))

    vi.resetModules()
    mockWin32ForIsolatedRuntime()
    vi.doMock('../src/linux-scope.ts', () => ({
      confirmLinuxManager: vi.fn(() => true),
      LinuxScopeNotStartedError,
      linuxManagerListener: vi.fn(() => undefined),
      signalLinuxDirectProcess,
      systemdRunIdentity: vi.fn(() => 'launcher'),
      launchLinuxScope,
      probeLinuxNative,
    }))
    vi.doMock('../src/spawn.ts', async importOriginal => ({
      ...await importOriginal<typeof import('../src/spawn.ts')>(),
      bindManagedProcess,
      spawnSubprocess,
    }))
    vi.doMock('../src/output.ts', async importOriginal => ({
      ...await importOriginal<typeof import('../src/output.ts')>(),
      prepareManagedProcessBinding: vi.fn(() => ({ spillDir: '/tmp/dsh-test-spill' })),
    }))
    let fiber: { dispose(): Promise<void> } | undefined
    try {
      const { default: IsolatedLocalSubprocessRuntime } = await import('../src/index.ts')
      const ctx = new Context()
      vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
      const debug = vi.spyOn(ctx.logger, 'debug').mockImplementation(() => {})
      fiber = await ctx.plugin(IsolatedLocalSubprocessRuntime)
      const runtime = ctx.subprocess as InstanceType<typeof IsolatedLocalSubprocessRuntime>
      runtime.internals = { platform: 'linux' }
      const settle = () => new Promise(resolve => setImmediate(resolve))

      runtime.spawn(spec('true'))
      runtime.spawn(spec('true'))
      scopeOutcomes[0]?.reject(new Error('scope target failed after starting'))
      await settle()
      runtime.spawn(spec('true'))
      scopeOutcomes[1]?.reject(new LinuxScopeNotStartedError('scope never started'))
      await settle()
      runtime.spawn(spec('true'))
      // A launch from the superseded probe keeps the newer verdict.
      scopeOutcomes[2]?.reject(new LinuxScopeNotStartedError('superseded launch'))
      await settle()
      runtime.spawn(spec('true'))

      expect(probeLinuxNative).toHaveBeenCalledTimes(2)
      expect(launchLinuxScope.mock.calls.map(([, , literalArgv]) => literalArgv)).toEqual([[], [], []])
      expect(spawnSubprocess).toHaveBeenCalledTimes(2)
      expect(debug.mock.calls.map(([message]) => String(message)).filter(message => message.startsWith('linux native'))).toEqual([
        'linux native containment: scope (probe-available, probed after first)',
        'linux native containment: scope (manager-confirmed)',
        'linux native containment: scope (manager-confirmed)',
        'linux native containment: fallback (probe-unavailable, probed after scope-not-started)',
        'linux native containment: fallback (no-listener)',
      ])
    } finally {
      for (const outcome of scopeOutcomes) outcome.resolve({ exitCode: 0, signal: null })
      await fiber?.dispose()
      vi.doUnmock('../src/linux-scope.ts')
      vi.doUnmock('../src/spawn.ts')
      vi.doUnmock('../src/output.ts')
      unmockWin32ForIsolatedRuntime()
      vi.resetModules()
    }
  })

  it('keeps a failed Linux native probe while no new user-manager listener appears and rechecks the Windows Job', async () => {
    const probeLinuxNative = vi.fn(() => undefined)
    const confirmLinuxManager = vi.fn(() => true)
    const linuxManagerListener = vi.fn(() => undefined)
    const probeWindowsJob = vi.fn()
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false)

    vi.resetModules()
    mockWin32ForIsolatedRuntime()
    vi.doMock('../src/linux-scope.ts', () => ({
      confirmLinuxManager,
      LinuxScopeNotStartedError,
      linuxManagerListener,
      signalLinuxDirectProcess,
      systemdRunIdentity: vi.fn(() => 'launcher'),
      launchLinuxScope: vi.fn(),
      probeLinuxNative,
    }))
    vi.doMock('../src/windows-job.ts', () => ({ launchWindowsJob: vi.fn(), probeWindowsJob }))
    const fibers: Array<{ dispose(): Promise<void> }> = []
    try {
      const { default: IsolatedLocalSubprocessRuntime } = await import('../src/index.ts')
      const linuxContext = new Context()
      vi.spyOn(linuxContext.logger, 'warn').mockImplementation(() => {})
      const linuxFiber = await linuxContext.plugin(IsolatedLocalSubprocessRuntime)
      fibers.push(linuxFiber)
      const linuxRuntime = linuxContext.subprocess as InstanceType<typeof IsolatedLocalSubprocessRuntime>
      linuxRuntime.internals = { platform: 'linux' }
      const linuxSelect = (linuxRuntime as unknown as {
        selectContainmentMode(): 'linux-scope' | 'windows-job' | 'fallback'
      }).selectContainmentMode.bind(linuxRuntime)

      expect(linuxSelect()).toBe('fallback')
      expect(linuxSelect()).toBe('fallback')
      expect(linuxSelect()).toBe('fallback')
      expect(probeLinuxNative).toHaveBeenCalledOnce()
      expect(confirmLinuxManager).not.toHaveBeenCalled()
      expect(linuxManagerListener).toHaveBeenCalledTimes(3)

      const windowsContext = new Context()
      vi.spyOn(windowsContext.logger, 'warn').mockImplementation(() => {})
      const windowsFiber = await windowsContext.plugin(IsolatedLocalSubprocessRuntime)
      fibers.push(windowsFiber)
      const windowsRuntime = windowsContext.subprocess as InstanceType<typeof IsolatedLocalSubprocessRuntime>
      windowsRuntime.internals = { platform: 'win32' }
      const windowsSelect = (windowsRuntime as unknown as {
        selectContainmentMode(): 'linux-scope' | 'windows-job' | 'fallback'
      }).selectContainmentMode.bind(windowsRuntime)

      expect(windowsSelect()).toBe('fallback')
      expect(windowsSelect()).toBe('windows-job')
      expect(windowsSelect()).toBe('fallback')
      expect(probeWindowsJob).toHaveBeenCalledTimes(3)
    } finally {
      for (const fiber of fibers.reverse()) await fiber.dispose()
      vi.doUnmock('../src/linux-scope.ts')
      vi.doUnmock('../src/windows-job.ts')
      unmockWin32ForIsolatedRuntime()
      vi.resetModules()
    }
  })

  it('disposal kills still-running processes and awaits their exit', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(LocalSubprocessRuntime)
    const handle = ctx.subprocess.spawn(spec('sleep 60'))
    await fiber.dispose()
    const outcome = await handle.done
    // Windows teardown terminates through taskkill, which reports no signal.
    expect(outcome.signal).toBe(process.platform === 'win32' ? null : 'SIGTERM')
  })

  it('a settled process leaves the live set (disposal does not re-kill it)', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(LocalSubprocessRuntime)
    const handle = ctx.subprocess.spawn(spec('true'))
    const outcome = await handle.done
    expect(outcome.exitCode).toBe(0)
    await fiber.dispose()
  })

  it('waits for retained control endpoint closure after a process range completes', async () => {
    const destroying = Promise.withResolvers<undefined>()
    const finishClose = Promise.withResolvers<undefined>()
    const control = new PassThrough({
      destroy(_error, callback) {
        destroying.resolve(undefined)
        void finishClose.promise.then(() => { callback(null) })
      },
    })
    const terminate = vi.fn()
    const waitForExit = vi.fn(() => Promise.resolve(true))
    const handle = {
      control,
      collected: {},
      done: Promise.resolve({ exitCode: 0, signal: null }),
      terminate,
      terminateForHostExit: vi.fn(),
      waitForExit,
    }
    vi.resetModules()
    mockWin32ForIsolatedRuntime()
    vi.doMock('../src/spawn.ts', async importOriginal => ({
      ...await importOriginal<typeof import('../src/spawn.ts')>(),
      spawnSubprocess: vi.fn(() => handle),
    }))
    let fiber: { dispose(): Promise<void> } | undefined
    try {
      const { default: IsolatedLocalSubprocessRuntime } = await import('../src/index.ts')
      const ctx = new Context()
      fiber = await ctx.plugin(IsolatedLocalSubprocessRuntime)
      const runtime = ctx.subprocess as InstanceType<typeof IsolatedLocalSubprocessRuntime>
      runtime.internals = { platform: 'darwin' }
      const spawned = runtime.spawn(spec('true', {
        stdio: { stdin: 'ignore', stdout: 'inherit', stderr: 'inherit', control: 'pipe' },
      }))
      await spawned.done
      await new Promise(resolve => setImmediate(resolve))
      expect(waitForExit).toHaveBeenCalledOnce()
      expect(control.destroyed).toBe(false)

      let disposed = false
      const disposal = fiber.dispose().then(() => { disposed = true })
      await destroying.promise
      expect(control.destroyed).toBe(true)
      expect(control.closed).toBe(false)
      expect(disposed).toBe(false)
      expect(terminate).not.toHaveBeenCalled()
      finishClose.resolve(undefined)
      await disposal
      expect(control.closed).toBe(true)
    } finally {
      finishClose.resolve(undefined)
      control.destroy()
      await fiber?.dispose()
      vi.doUnmock('../src/spawn.ts')
      unmockWin32ForIsolatedRuntime()
      vi.resetModules()
    }
  })

  it('disposal tolerates a handle whose spawn already failed', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(LocalSubprocessRuntime)
    const handle = ctx.subprocess.spawn(spec('true', { cwd: '/nonexistent-dir-dsh-subprocess-test' }))
    await expect(handle.done).rejects.toThrow()
    await fiber.dispose()
  })

  it('disposal contains a spawn-failure rejection that races teardown', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(LocalSubprocessRuntime)
    // Dispose before the rejection continuation removes the handle from the
    // live set, so teardown itself must swallow the rejected done. Two
    // settlements are valid and the winner is a race: a bootstrap that
    // publishes its pre-exec failure rejects with that failure, and a teardown
    // that stops the bootstrap first settles as the requested termination —
    // the recorded failure only outranks the stop when it was published before
    // the stop landed.
    const handle = ctx.subprocess.spawn(spec('true', { cwd: '/nonexistent-dir-dsh-subprocess-test' }))
    await fiber.dispose()
    const settlement = await handle.done.then(
      outcome => ({ kind: 'stopped' as const, outcome }),
      (error: unknown) => ({ kind: 'failed' as const, error }),
    )
    if (settlement.kind === 'failed') {
      expect(settlement.error).toBeInstanceOf(Error)
    } else {
      // Only the Linux scope records a stop this way: the win32 job owner
      // rejects a cancelled start and the fallback launcher rejects the ENOENT,
      // so neither can produce the stopped branch.
      expect(settlement.outcome.signal).toBe('SIGTERM')
    }
  })

  it('loading a second implementation throws (one processes service per context — cordis standard)', async () => {
    const ctx = new Context()
    await ctx.plugin(LocalSubprocessRuntime)
    class SecondManager extends LocalSubprocessRuntime {}
    await expect(ctx.plugin(SecondManager)).rejects.toThrow(/service "subprocess" has been registered/)
  })
})
