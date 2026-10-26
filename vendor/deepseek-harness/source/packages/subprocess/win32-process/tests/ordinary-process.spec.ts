import koffi from 'koffi'
import { describe, expect, it, vi } from 'vitest'
import {
  closeHandleChecked,
  isJobEmpty,
  pollProcessExit,
  probeCurrentTokenJobSupport,
  spawnCurrentTokenJobProcess,
  terminateJob,
  Win32Error,
} from '../src/index.ts'
import {
  CREATE_SUSPENDED,
  CREATE_UNICODE_ENVIRONMENT,
  JOBOBJECT_BASIC_ACCOUNTING_ACTIVE_PROCESSES_OFFSET,
  JOBOBJECT_BASIC_ACCOUNTING_SIZE,
  JobObjectBasicAccountingInformation,
  WAIT_TIMEOUT,
} from '../src/abi.ts'
import { processInformationType, startupInfoType } from '../src/ffi.ts'
import type {
  CurrentTokenProcessSpawnOptions,
  CurrentTokenProcessBindings,
  NativePtr,
} from '../src/index.ts'

function options(
  overrides: Partial<CurrentTokenProcessSpawnOptions> = {},
): CurrentTokenProcessSpawnOptions {
  return {
    command: 'probe.exe',
    applicationName: 'C:\\resolved\\probe.exe',
    args: [],
    cwd: 'C:\\work',
    env: {},
    stdio: { stdin: 4, stdout: 5, stderr: 6 },
    ...overrides,
  }
}

function api(overrides: Partial<CurrentTokenProcessBindings> = {}): CurrentTokenProcessBindings {
  return {
    createJobObjectW: vi.fn(() => 50n),
    setInformationJobObject: vi.fn(() => 1),
    queryInformationJobObject: vi.fn((_job: NativePtr, _cls: number, information: Buffer) => {
      information.writeUInt32LE(0, JOBOBJECT_BASIC_ACCOUNTING_ACTIVE_PROCESSES_OFFSET)
      return 1
    }),
    uvGetOsfhandle: vi.fn((fileDescriptor: number) => BigInt(100 + fileDescriptor)),
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
    terminateProcess: vi.fn(() => 1),
    terminateJobObject: vi.fn(() => 1),
    waitForSingleObject: vi.fn(() => 0),
    getExitCodeProcess: vi.fn((_process, slot) => {
      koffi.encode(slot, 'uint32', 42)
      return 1
    }),
    closeHandle: vi.fn(() => 1),
    getLastError: vi.fn(() => 5),
    formatMessageW: vi.fn(() => 0),
    ...overrides,
  } as CurrentTokenProcessBindings
}

describe('ordinary Job process operations', () => {
  it.each([3, 2])('supplies fd 7 with standard handle type %s and releases its temporary inheritance', (standardType) => {
    let descriptorBytes: Buffer | undefined
    const flags = vi.fn(() => 1)
    const bindings = api({
      getFileType: vi.fn(handle => handle === 107n ? 3 : standardType),
      setHandleInformation: flags,
      createProcessW: vi.fn((_app, _line, _pa, _ta, _inherit, _flags, _env, _cwd, startupPointer, processInfo) => {
        const startup = koffi.decode(startupPointer, startupInfoType()) as { cbReserved2: number; lpReserved2: NativePtr }
        descriptorBytes = Buffer.from(koffi.decode(startup.lpReserved2, 'uint8', startup.cbReserved2) as number[])
        koffi.encode(processInfo, processInformationType(), { hProcess: 60n, hThread: 61n, dwProcessId: 1234, dwThreadId: 5678 })
        return 1
      }),
    })
    expect(spawnCurrentTokenJobProcess(bindings, options({
      stdio: { stdin: 4, stdout: 5, stderr: 6, control: 7 },
    }))).toEqual({ pid: 1234, process: 60n, job: 50n })
    const bytes = descriptorBytes as Buffer
    expect(bytes.readUInt32LE(0)).toBe(8)
    const standardFlag = standardType === 3 ? 9 : 65
    expect([...bytes.subarray(4, 12)]).toEqual([standardFlag, standardFlag, standardFlag, 0, 0, 0, 0, 9])
    expect(bytes.readBigUInt64LE(12 + 7 * 8)).toBe(107n)
    expect(bytes.readBigUInt64LE(12 + 3 * 8)).toBe(0xffff_ffff_ffff_ffffn)
    expect(flags).toHaveBeenCalledWith(107n, 1, 1)
    expect(flags).toHaveBeenCalledWith(107n, 1, 0)
  })

  it('refuses a control carrier that is not a pipe before creating the target', () => {
    const createProcessW = vi.fn()
    const closeHandle = vi.fn(() => 1)
    const setHandleInformation = vi.fn(() => 1)
    const bindings = api({ getFileType: vi.fn(() => 1), createProcessW, closeHandle, setHandleInformation })
    expect(() => spawnCurrentTokenJobProcess(bindings, options({
      stdio: { stdin: 4, stdout: 5, stderr: 6, control: 7 },
    }))).toThrow('not a Windows pipe')
    expect(createProcessW).not.toHaveBeenCalled()
    expect(closeHandle).toHaveBeenCalledWith(50n)
    expect(setHandleInformation).toHaveBeenCalledWith(107n, 1, 0)
  })

  it('creates suspended, assigns the Job, and resumes before returning', () => {
    const events: string[] = []
    const createProcessW = vi.fn((
      _app: unknown,
      _line: unknown,
      _pa: unknown,
      _ta: unknown,
      _inherit: unknown,
      _flags: unknown,
      _env: unknown,
      _cwd: unknown,
      _startup: unknown,
      info: NativePtr,
    ) => {
      events.push('create')
      koffi.encode(info, processInformationType(), { hProcess: 60n, hThread: 61n, dwProcessId: 1234, dwThreadId: 5678 })
      return 1
    })
    const bindings = api({
      createProcessW,
      assignProcessToJobObject: vi.fn(() => { events.push('assign'); return 1 }),
      resumeThread: vi.fn(() => { events.push('resume'); return 0 }),
      closeHandle: vi.fn((handle: NativePtr) => { events.push(`close:${handle}`); return 1 }),
    })
    expect(spawnCurrentTokenJobProcess(bindings, options({
      args: ['literal $VALUE', 'a b'],
      env: {
        ZED: 'last',
        '=C:': 'C:\\work',
        alpha: 'first',
        ALPHA: 'same-folded-key',
        _A: 'underscore',
      },
    }))).toEqual({ pid: 1234, process: 60n, job: 50n })
    const environment = createProcessW.mock.calls[0]?.[6] as Buffer
    expect(createProcessW).toHaveBeenCalledWith(
      'C:\\resolved\\probe.exe',
      'probe.exe "literal $VALUE" "a b"',
      null,
      null,
      1,
      CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT,
      environment,
      'C:\\work',
      expect.anything(),
      expect.anything(),
    )
    expect(environment.toString('utf16le')).toBe(
      '=C:=C:\\work\0alpha=first\0ALPHA=same-folded-key\0ZED=last\0_A=underscore\0\0',
    )
    expect(events.indexOf('create')).toBeLessThan(events.indexOf('assign'))
    expect(events.indexOf('assign')).toBeLessThan(events.indexOf('resume'))
    expect(events).toContain('close:61')
  })

  it('resolves the target carrier descriptors and restores their handle flags', () => {
    let startup: Record<string, unknown> | undefined
    const setHandleInformation = vi.fn(() => 1)
    const uvGetOsfhandle = vi.fn(
      (fileDescriptor: number) => BigInt(100 + fileDescriptor) as NativePtr,
    )
    const bindings = api({
      setHandleInformation,
      uvGetOsfhandle,
      createProcessW: vi.fn((_app, _line, _pa, _ta, _inherit, _flags, _env, _cwd, infoPtr, processInfo) => {
        startup = koffi.decode(infoPtr, startupInfoType()) as Record<string, unknown>
        koffi.encode(processInfo, processInformationType(), {
          hProcess: 60n,
          hThread: 61n,
          dwProcessId: 1234,
          dwThreadId: 5678,
        })
        return 1
      }),
    })
    expect(spawnCurrentTokenJobProcess(bindings, options())).toEqual({ pid: 1234, process: 60n, job: 50n })
    expect(startup).toMatchObject({ dwFlags: 0x101, wShowWindow: 0, hStdInput: 104n, hStdOutput: 105n, hStdError: 106n })
    expect(uvGetOsfhandle).toHaveBeenNthCalledWith(1, 4)
    expect(uvGetOsfhandle).toHaveBeenNthCalledWith(2, 5)
    expect(uvGetOsfhandle).toHaveBeenNthCalledWith(3, 6)
    expect(setHandleInformation.mock.calls).toEqual([
      [104n, 1, 1], [105n, 1, 1], [106n, 1, 1],
      [104n, 1, 0], [105n, 1, 0], [106n, 1, 0],
    ])
  })

  it('polls direct exit and Job emptiness without blocking', () => {
    const queryInformationJobObject = vi.fn((_job: NativePtr, _cls: number, information: Buffer) => {
      information.writeUInt32LE(1, JOBOBJECT_BASIC_ACCOUNTING_ACTIVE_PROCESSES_OFFSET)
      return 1
    })
    const running = api({
      waitForSingleObject: vi.fn(() => WAIT_TIMEOUT),
      queryInformationJobObject,
    })
    expect(pollProcessExit(running, 60n as NativePtr)).toBeUndefined()
    expect(isJobEmpty(running, 50n as NativePtr)).toBe(false)
    expect(queryInformationJobObject).toHaveBeenCalledWith(
      50n,
      JobObjectBasicAccountingInformation,
      expect.objectContaining({ length: JOBOBJECT_BASIC_ACCOUNTING_SIZE }),
      JOBOBJECT_BASIC_ACCOUNTING_SIZE,
      null,
    )

    const exited = api()
    expect(pollProcessExit(exited, 60n as NativePtr)).toBe(42)
    expect(isJobEmpty(exited, 50n as NativePtr)).toBe(true)
  })

  it('reports wait and exit-code query failures', () => {
    const processWait = api({ waitForSingleObject: vi.fn(() => 0xFFFFFFFF) })
    expect(() => pollProcessExit(processWait, 60n as NativePtr)).toThrow(Win32Error)

    const exitCode = api({ getExitCodeProcess: vi.fn(() => 0) })
    expect(() => pollProcessExit(exitCode, 60n as NativePtr)).toThrow(Win32Error)

    const jobQuery = api({ queryInformationJobObject: vi.fn(() => 0) })
    expect(() => isJobEmpty(jobQuery, 50n as NativePtr)).toThrow(Win32Error)
  })

  it('checks Job termination and caller-owned handle closure', () => {
    const terminateJobObject = vi.fn(() => 1)
    const bindings = api({ terminateJobObject })
    expect(() => { terminateJob(bindings, 50n as NativePtr, 1) }).not.toThrow()
    expect(() => { closeHandleChecked(bindings, 50n as NativePtr, 'test Job') }).not.toThrow()
    expect(terminateJobObject).toHaveBeenCalledWith(50n, 1)

    const failing = api({ terminateJobObject: vi.fn(() => 0) })
    expect(() => { terminateJob(failing, 50n as NativePtr, 1) }).toThrow(Win32Error)

    const closeFailure = api({ closeHandle: vi.fn(() => 0) })
    expect(() => { closeHandleChecked(closeFailure, 50n as NativePtr, 'test Job') }).toThrow(Win32Error)
  })

  it('probes an unnamed Job and closes its handle', () => {
    const closeHandle = vi.fn(() => 1)
    const bindings = api({ closeHandle })
    expect(() => { probeCurrentTokenJobSupport(bindings) }).not.toThrow()
    expect(closeHandle).toHaveBeenCalledExactlyOnceWith(50n)
  })

  it('rejects invalid carrier handles before target creation', () => {
    const expectFailure = (invalid: NativePtr | null): void => {
      const closeHandle = vi.fn(() => 1)
      const createProcessW = vi.fn(() => 1)
      expect(() => spawnCurrentTokenJobProcess(api({
        closeHandle,
        createProcessW,
        uvGetOsfhandle: vi.fn(() => invalid),
      }), options())).toThrow('uv_get_osfhandle returned an invalid handle for target stdin fd 4')
      expect(closeHandle).toHaveBeenCalledWith(50n)
      expect(createProcessW).not.toHaveBeenCalled()
    }

    for (const invalid of [null, 0n, 0xffff_ffff_ffff_ffffn, 0xffff_ffff_ffff_fffen]) {
      expectFailure(invalid as NativePtr | null)
    }
  })
  it('restores enabled stdio and closes the Job when inheritance setup fails', () => {
    let calls = 0
    const bindings = api({
      setHandleInformation: vi.fn((_handle, _mask, flags) => flags === 0 || ++calls !== 2 ? 1 : 0),
    })
    expect(() => spawnCurrentTokenJobProcess(bindings, options())).toThrow(Win32Error)
    expect(bindings.setHandleInformation).toHaveBeenCalledWith(104n, 1, 0)
    expect(bindings.closeHandle).toHaveBeenCalledExactlyOnceWith(50n)
    expect(bindings.createProcessW).not.toHaveBeenCalled()
  })

  it('preserves the CreateProcessW error when cleanup changes last-error', () => {
    let lastError = 87
    const bindings = api({
      createProcessW: vi.fn(() => 0),
      getLastError: vi.fn(() => lastError),
      setHandleInformation: vi.fn((_handle, _mask, flags) => {
        if (flags === 0) lastError = 999
        return 1
      }),
      closeHandle: vi.fn(() => { lastError = 998; return 1 }),
    })
    expect(() => spawnCurrentTokenJobProcess(bindings, options())).toThrow(
      expect.objectContaining({ api: 'CreateProcessW', win32Code: 87 }),
    )
    expect(bindings.closeHandle).toHaveBeenCalledExactlyOnceWith(50n)
  })

  it.each([null, 60n])('reclaims a suspended child with process %s and a null thread', (process) => {
    const bindings = api({
      createProcessW: vi.fn((_app, _line, _pa, _ta, _inherit, _flags, _env, _cwd, _startup, info) => {
        koffi.encode(info, processInformationType(), {
          hProcess: process, hThread: null, dwProcessId: 1234, dwThreadId: 0,
        })
        return 1
      }),
    })
    expect(() => spawnCurrentTokenJobProcess(bindings, options())).toThrow('null process/thread handles')
    expect(vi.mocked(bindings.closeHandle).mock.calls).toEqual(process === null ? [[50n]] : [[50n], [60n]])
    if (process === null) expect(bindings.terminateProcess).not.toHaveBeenCalled()
    else expect(bindings.terminateProcess).toHaveBeenCalledExactlyOnceWith(60n, 1)
    expect(bindings.resumeThread).not.toHaveBeenCalled()
  })

  it('terminates the suspended child before releasing handles when Job assignment fails', () => {
    const events: string[] = []
    const bindings = api({
      assignProcessToJobObject: vi.fn(() => 0),
      terminateProcess: vi.fn((process, code) => { events.push(`terminate:${process}:${code}`); return 1 }),
      closeHandle: vi.fn(handle => { events.push(`close:${handle}`); return 1 }),
    })
    expect(() => spawnCurrentTokenJobProcess(bindings, options())).toThrow(
      expect.objectContaining({ api: 'AssignProcessToJobObject', win32Code: 5 }),
    )
    expect(events).toEqual(['terminate:60:1', 'close:61', 'close:60', 'close:50'])
    expect(bindings.resumeThread).not.toHaveBeenCalled()
  })

  it('closes the assigned child and kill-on-close Job when ResumeThread fails', () => {
    const bindings = api({ resumeThread: vi.fn(() => 0xFFFFFFFF) })
    expect(() => spawnCurrentTokenJobProcess(bindings, options())).toThrow(
      expect.objectContaining({ api: 'ResumeThread', win32Code: 5 }),
    )
    expect(vi.mocked(bindings.closeHandle).mock.calls).toEqual([[61n], [60n], [50n]])
  })

  it('preserves Job configuration errors across handle cleanup', () => {
    let lastError = 5
    const bindings = api({
      setInformationJobObject: vi.fn(() => 0),
      getLastError: vi.fn(() => lastError),
      closeHandle: vi.fn(() => { lastError = 999; return 1 }),
    })
    expect(() => spawnCurrentTokenJobProcess(bindings, options())).toThrow(
      expect.objectContaining({ api: 'SetInformationJobObject', win32Code: 5 }),
    )
    expect(bindings.closeHandle).toHaveBeenCalledExactlyOnceWith(50n)
    expect(bindings.createProcessW).not.toHaveBeenCalled()
  })

  it('reports a null Job without starting a child', () => {
    const bindings = api({ createJobObjectW: vi.fn(() => 0n as NativePtr) })
    expect(() => spawnCurrentTokenJobProcess(bindings, options())).toThrow(
      expect.objectContaining({ api: 'CreateJobObjectW', win32Code: 5 }),
    )
    expect(bindings.createProcessW).not.toHaveBeenCalled()
    expect(bindings.closeHandle).not.toHaveBeenCalled()
  })

})
