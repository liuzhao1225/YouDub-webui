/** Cross-platform native path opener behavior. */
type ExecFileCallback = (
  error: (Error & { code?: string | number }) | null,
  stdout: string,
  stderr: string,
) => void
type ExecFileMock = (
  command: string,
  args: readonly string[],
  options: { encoding: string; signal: AbortSignal; windowsHide: boolean },
  callback: ExecFileCallback,
) => void

const { execFileMock } = vi.hoisted(() => ({ execFileMock: vi.fn<ExecFileMock>() }))

vi.mock('node:child_process', () => ({ execFile: execFileMock }))

import { release as osRelease } from 'node:os'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { openNativeTextFile, type PathOpenerRunner } from '../src/index.ts'

const signal = () => new AbortController().signal

beforeEach(() => { execFileMock.mockReset() })

describe('native path opener', () => {
  it('bypasses macOS file associations for text documents', async () => {
    const run = vi.fn<PathOpenerRunner>(async () => ({ stdout: '', stderr: '' }))
    await openNativeTextFile('/Users/test/settings.yaml', signal(), { platform: 'darwin', run })
    expect(run).toHaveBeenCalledWith('open', ['-t', '/Users/test/settings.yaml'], expect.any(AbortSignal), 'hidden')
  })

  it('uses the Linux desktop association for text documents', async () => {
    const run = vi.fn<PathOpenerRunner>(async () => ({ stdout: '', stderr: '' }))
    await openNativeTextFile('/tmp/settings.yaml', signal(), {
      platform: 'linux', osRelease: '6.8.0-generic', env: {}, run,
    })
    expect(run).toHaveBeenCalledWith('xdg-open', ['/tmp/settings.yaml'], expect.any(AbortSignal), 'hidden')
  })

  it.each([
    ['distribution marker', { WSL_DISTRO_NAME: 'Ubuntu' }, '6.8.0-generic'],
    ['interop marker', { WSL_INTEROP: '/run/WSL/123_interop' }, '6.8.0-generic'],
    ['kernel release', {}, '5.15.153.1-microsoft-standard-WSL2'],
  ])('hands WSL text documents to the Windows desktop from the %s', async (_label, env, osRelease) => {
    const requestSignal = signal()
    const run = vi.fn<PathOpenerRunner>(async command => command === 'wslpath'
      ? { stdout: '\\\\wsl.localhost\\Ubuntu\\home\\test user\\settings.yaml\r\n', stderr: '' }
      : { stdout: '', stderr: '' })
    await openNativeTextFile('/home/test user/settings.yaml', requestSignal, {
      platform: 'linux', osRelease, env, run,
    })
    expect(run.mock.calls).toEqual([
      ['wslpath', ['-w', '/home/test user/settings.yaml'], requestSignal, 'hidden'],
      ['explorer.exe', ['file://wsl.localhost/Ubuntu/home/test%20user/settings.yaml'], requestSignal, 'visible'],
    ])
  })

  it('rejects an empty WSL path translation before invoking Windows', async () => {
    const run = vi.fn<PathOpenerRunner>(async () => ({ stdout: '\r\n', stderr: '' }))
    await expect(openNativeTextFile('/home/test/settings.yaml', signal(), {
      platform: 'linux', osRelease: '6.8.0-generic', env: { WSL_DISTRO_NAME: 'Ubuntu' }, run,
    })).rejects.toThrow('wslpath returned no Windows path')
    expect(run).toHaveBeenCalledOnce()
  })

  it('does not invoke Windows when the request aborts during WSL path translation', async () => {
    const abort = new AbortController()
    const run = vi.fn<PathOpenerRunner>(async () => {
      abort.abort(new Error('closed'))
      return { stdout: '\\\\wsl.localhost\\Ubuntu\\home\\test\\settings.yaml\n', stderr: '' }
    })
    await expect(openNativeTextFile('/home/test/settings.yaml', abort.signal, {
      platform: 'linux', osRelease: '6.8.0-generic', env: { WSL_DISTRO_NAME: 'Ubuntu' }, run,
    })).rejects.toThrow('closed')
    expect(run).toHaveBeenCalledOnce()
  })

  it.each([
    // Explorer parses its own command line and splits fields at commas and
    // equals signs, and libuv quotes an argument only when it holds a space, so
    // the encoded file URI is what keeps the whole path in one field. Only those
    // two separators are escaped on top of the URI's own encoding: Explorer
    // rejects percent-encoded non-ASCII and opens Documents instead, while it
    // resolves the literal characters, so `报告` stays literal here. UNC takes
    // the same encoding.
    ["C:\\work\\o'reilly, & 100%.txt", "file:///C:/work/o'reilly%2C%20&%20100%25.txt"],
    ['C:\\work\\plain.txt', 'file:///C:/work/plain.txt'],
    ['C:\\work\\my report.txt', 'file:///C:/work/my%20report.txt'],
    ['C:\\work\\key=value.txt', 'file:///C:/work/key%3Dvalue.txt'],
    ['C:\\my files\\报告,#%.txt', 'file:///C:/my%20files/报告%2C%23%25.txt'],
    ['C:\\目录\\a,b=c.txt', 'file:///C:/目录/a%2Cb%3Dc.txt'],
    ['C:\\工作\\报告 2026.txt', 'file:///C:/工作/报告%202026.txt'],
    ['\\\\server\\share\\a,b.txt', 'file://server/share/a%2Cb.txt'],
    // Node resolves the path before encoding it, so a verbatim prefix is not
    // part of the target: `\\?\` and `\\?\UNC\` arrive as the ordinary drive or
    // UNC URI. A device-namespace path takes that same UNC handling; it names a
    // device rather than a shell item, which this opener does not open.
    ['\\\\?\\C:\\work\\a,b.txt', 'file:///C:/work/a%2Cb.txt'],
    ['\\\\?\\UNC\\server\\share\\a,b.txt', 'file://server/share/a%2Cb.txt'],
    ['\\\\.\\C:\\work\\a,b.txt', 'file://./C:/work/a%2Cb.txt'],
    ['\\\\wsl$\\Ubuntu\\home\\t,est a.txt', 'file://wsl$/Ubuntu/home/t%2Cest%20a.txt'],
  ] as const)('opens %s through the one encoded Explorer target', async (path, target) => {
    const run = vi.fn<PathOpenerRunner>(async () => ({ stdout: '', stderr: '' }))
    await openNativeTextFile(path, signal(), { platform: 'win32', run })
    expect(run).toHaveBeenCalledExactlyOnceWith('explorer.exe', [target], expect.any(AbortSignal), 'visible')
  })

  // Node restores a trailing separator against the host's `path.sep`, so a
  // separator-terminated Windows path encodes differently on the Windows host
  // this opener runs on than on the POSIX host a test run may use.
  it('encodes a separator-terminated drive root as the hosting platform resolves it', async () => {
    const run = vi.fn<PathOpenerRunner>(async () => ({ stdout: '', stderr: '' }))
    await openNativeTextFile('C:\\', signal(), { platform: 'win32', run })
    expect(run).toHaveBeenCalledExactlyOnceWith(
      'explorer.exe',
      [process.platform === 'win32' ? 'file:///C:/' : 'file:///C://'],
      expect.any(AbortSignal),
      'visible',
    )
  })

  it('encodes a directory target the same way it encodes a file target', async () => {
    const run = vi.fn<PathOpenerRunner>(async () => ({ stdout: '', stderr: '' }))
    await openNativeTextFile('C:\\work\\dir,comma', signal(), { platform: 'win32', run })
    expect(run).toHaveBeenCalledWith(
      'explorer.exe',
      ['file:///C:/work/dir%2Ccomma'],
      expect.any(AbortSignal),
      'visible',
    )
  })

  it('uses the Windows desktop association for text documents', async () => {
    const run = vi.fn<PathOpenerRunner>(async () => ({ stdout: '', stderr: '' }))
    await openNativeTextFile('C:\\work\\settings.yaml', signal(), { platform: 'win32', run })
    expect(run).toHaveBeenCalledWith(
      'explorer.exe',
      ['file:///C:/work/settings.yaml'],
      expect.any(AbortSignal),
      'visible',
    )
  })

  it('opens with Linux xdg-open', async () => {
    const run = vi.fn<PathOpenerRunner>(async () => ({ stdout: '', stderr: '' }))
    await openNativeTextFile('/tmp/a.txt', signal(), {
      platform: 'linux', osRelease: '6.8.0-generic',
      env: { WSL_DISTRO_NAME: '', WSL_INTEROP: '' }, run,
    })
    expect(run).toHaveBeenCalledWith('xdg-open', ['/tmp/a.txt'], expect.any(AbortSignal), 'hidden')
  })

  it('rejects unsupported platforms', async () => {
    await expect(openNativeTextFile('/x', signal(), { platform: 'freebsd' as NodeJS.Platform }))
      .rejects.toThrow('unsupported on freebsd')
  })

  it('uses the current process platform when no platform override is supplied', async () => {
    const run = vi.fn<PathOpenerRunner>(async () => ({ stdout: '', stderr: '' }))
    await openNativeTextFile('/tmp/platform-default.txt', signal(), {
      osRelease: '6.8.0-generic', env: {}, run,
    })
    const expected = process.platform === 'win32'
      ? 'explorer.exe'
      : process.platform === 'linux'
        ? 'xdg-open'
        : 'open'
    expect(run.mock.calls[0]?.[0]).toBe(expected)
  })

  it('samples ambient WSL markers and kernel release when no fact overrides are supplied', async () => {
    const ambientWsl = [process.env.WSL_DISTRO_NAME, process.env.WSL_INTEROP]
      .some(value => value !== undefined && value !== '')
      || osRelease().toLowerCase().includes('microsoft')
    const run = vi.fn<PathOpenerRunner>(async command => command === 'wslpath'
      ? { stdout: 'C:\\settings.yaml\n', stderr: '' }
      : { stdout: '', stderr: '' })
    await openNativeTextFile('/tmp/ambient-facts.yaml', signal(), { platform: 'linux', run })
    expect(run.mock.calls[0]?.[0]).toBe(ambientWsl ? 'wslpath' : 'xdg-open')
  })

  it('keeps Explorer windows visible through the default text-file adapter', async () => {
    execFileMock.mockImplementationOnce((_command, _args, _options, callback) => {
      callback(null, '', '')
    })
    await openNativeTextFile('C:\\work\\report.txt', signal(), { platform: 'win32' })
    expect(execFileMock.mock.lastCall?.[0]).toBe('explorer.exe')
    expect(execFileMock.mock.lastCall?.[2].windowsHide).toBe(false)
  })

  it('runs the default command adapter without a shell and preserves command failures', async () => {
    execFileMock.mockImplementationOnce((_command, _args, _options, callback) => {
      callback(null, '', '')
    })
    await openNativeTextFile('/tmp/default.txt', signal(), { platform: 'darwin' })
    const [command, args, options] = execFileMock.mock.calls[0]!
    expect(command).toBe('open')
    expect(args).toEqual(['-t', '/tmp/default.txt'])
    expect(options.encoding).toBe('utf8')
    expect(options.windowsHide).toBe(true)
    expect(options.signal).toBeInstanceOf(AbortSignal)

    const commandError = Object.assign(new Error('open failed'), { code: 1 })
    execFileMock.mockImplementationOnce((_command, _args, _options, callback) => {
      callback(commandError, 'partial output', 'failure details')
    })
    await expect(openNativeTextFile('/tmp/missing.txt', signal(), { platform: 'darwin' })).rejects.toMatchObject({
      message: 'open failed', cause: commandError, code: 1,
      stdout: 'partial output', stderr: 'failure details',
    })
  })
})

it.each(['win32', 'linux'] as const)('accepts Explorer delegate exit 1 through the native runner on %s', async (platform) => {
  execFileMock.mockImplementation((command, _args, _options, callback) => {
    if (command === 'wslpath') callback(null, 'C:\\work\\report.txt', '')
    else callback(Object.assign(new Error('delegated'), { code: 1 }), '', '')
  })
  await expect(openNativeTextFile(platform === 'win32' ? 'C:\\work\\report.txt' : '/mnt/c/work/report.txt', signal(),
    { platform, env: { WSL_DISTRO_NAME: 'Ubuntu' } })).resolves.toBeUndefined()
})

it.each([2, 'ENOENT', undefined])('preserves Explorer failure %s', async (code) => {
  const failure = Object.assign(new Error('launch failed'), code === undefined ? {} : { code })
  execFileMock.mockImplementation((_command, _args, _options, callback) => { callback(failure, '', '') })
  await expect(openNativeTextFile('C:\\file.txt', signal(), { platform: 'win32' })).rejects.toMatchObject({ code })
})

it('preserves cancellation even when Explorer returns delegate exit 1', async () => {
  const abort = new AbortController()
  const reason = new Error('cancelled')
  const run = vi.fn<PathOpenerRunner>(async () => {
    abort.abort(reason)
    throw Object.assign(new Error('delegated'), { code: 1 })
  })
  await expect(openNativeTextFile('C:\\file.txt', abort.signal, { platform: 'win32', run })).rejects.toBe(reason)
})

it.each(['win32', 'linux'] as const)('accepts the Explorer delegate exit 1 when opening on %s', async (platform) => {
  const run = vi.fn<PathOpenerRunner>(async (command) => {
    if (command === 'wslpath') return { stdout: 'C:\\work\\settings.yaml', stderr: '' }
    throw Object.assign(new Error('delegated'), { code: 1 })
  })
  await expect(openNativeTextFile(
    platform === 'win32' ? 'C:\\work\\settings.yaml' : '/mnt/c/work/settings.yaml', signal(),
    { platform, env: { WSL_DISTRO_NAME: 'Ubuntu' }, run },
  )).resolves.toBeUndefined()
})

it('preserves a non-delegate Explorer failure when opening', async () => {
  const failure = Object.assign(new Error('launch failed'), { code: 2 })
  const run = vi.fn<PathOpenerRunner>().mockRejectedValue(failure)
  await expect(openNativeTextFile('C:\\file.txt', signal(), { platform: 'win32', run })).rejects.toBe(failure)
})
