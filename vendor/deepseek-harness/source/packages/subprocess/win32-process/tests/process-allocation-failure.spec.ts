import koffi from 'koffi'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  spawnCurrentTokenJobProcess,
  pollProcessExit,
} from '../src/index.ts'
import * as ffi from '../src/ffi.ts'
import { processInformationType } from '../src/ffi.ts'
import * as koffiLoader from '../src/koffi.ts'
import type { NativePtr, CurrentTokenProcessBindings } from '../src/ffi.ts'

vi.mock('../src/ffi.ts', { spy: true })
vi.mock('../src/koffi.ts', { spy: true })

beforeEach(() => {
  vi.mocked(koffiLoader.requireKoffi).mockReturnValue(koffi)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('spawnCurrentTokenJobProcess allocation cleanup', () => {
  it('frees startup info when process-info allocation throws', () => {
    const api = {
      createJobObjectW: vi.fn(() => 50n),
      setInformationJobObject: vi.fn(() => 1),
      uvGetOsfhandle: vi.fn((descriptor: number) => BigInt(100 + descriptor)),
      setHandleInformation: vi.fn(() => 1),
      closeHandle: vi.fn(() => 1),
      getLastError: vi.fn(() => 5),
      formatMessageW: vi.fn(() => 0),
    } as unknown as CurrentTokenProcessBindings
    const free = vi.spyOn(koffi, 'free')
    vi.mocked(ffi.allocProcessInfo).mockImplementationOnce(() => { throw new Error('process-info allocation failed') })
    expect(() => spawnCurrentTokenJobProcess(api, {
      command: 'cmd.exe',
      args: [],
      cwd: 'C:\\',
      applicationName: 'cmd.exe',
      env: {},
      stdio: { stdin: 4, stdout: 5, stderr: 6 },
    })).toThrow('process-info allocation failed')
    expect(free).toHaveBeenCalledOnce()
  })

  it('frees process info after a successful current-user spawn', () => {
    const api = {
      createJobObjectW: vi.fn(() => 50n),
      setInformationJobObject: vi.fn(() => 1),
      uvGetOsfhandle: vi.fn((descriptor: number) => BigInt(100 + descriptor)),
      setHandleInformation: vi.fn(() => 1),
      createProcessW: vi.fn((_app, _line, _pa, _ta, _inherit, _flags, _env, _cwd, _startup, info) => {
        koffi.encode(info, processInformationType(), {
          hProcess: 60n,
          hThread: 61n,
          dwProcessId: 1234,
          dwThreadId: 5678,
        })
        return 1
      }),
      assignProcessToJobObject: vi.fn(() => 1),
      resumeThread: vi.fn(() => 0),
      closeHandle: vi.fn(() => 1),
      getLastError: vi.fn(() => 5),
      formatMessageW: vi.fn(() => 0),
    } as unknown as CurrentTokenProcessBindings
    const free = vi.spyOn(koffi, 'free')
    expect(spawnCurrentTokenJobProcess(api, {
      command: 'cmd.exe',
      args: [],
      cwd: 'C:\\',
      applicationName: 'cmd.exe',
      env: {},
      stdio: { stdin: 4, stdout: 5, stderr: 6 },
    })).toEqual({ pid: 1234, process: 60n, job: 50n })
    expect(free).toHaveBeenCalledTimes(2)
  })
})

describe('shared process allocation cleanup', () => {
  it('frees the exit-code slot after reading a process result', () => {
    const api = {
      waitForSingleObject: vi.fn(() => 0),
      getExitCodeProcess: vi.fn((_process, exitCode: NativePtr) => {
        koffi.encode(exitCode, 'uint32', 42)
        return 1
      }),
      closeHandle: vi.fn(() => 1),
    } as unknown as CurrentTokenProcessBindings
    const free = vi.spyOn(koffi, 'free')
    expect(pollProcessExit(api, 60n as NativePtr)).toBe(42)
    expect(free).toHaveBeenCalledOnce()
  })
})
