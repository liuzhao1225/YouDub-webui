/** Typed Win32 process operations over the shared binding table. */

import * as abi from './abi.ts'
import { inheritedControlStdio } from './control-stdio.ts'
import {
  allocProcessInfo,
  allocStartupInfo,
  allocUint32,
  decodeProcessInfo,
  decodeUint32,
  encodeStartupInfo,
  isNullPtr,
  throwLastError,
  throwWin32,
} from './ffi.ts'
import type { CurrentTokenProcessBindings, NativePtr, Win32ProcessBindings } from './ffi.ts'
import { requireKoffi } from './koffi.ts'

/**
 * Quote one argument according to CommandLineToArgvW parsing.
 * @param argument - one argv entry.
 * @returns bare or quoted command-line segment.
 */
export function quoteArg(argument: string): string {
  if (argument === '') return '""'
  if (!/[\s"]/u.test(argument)) return argument
  let quoted = '"'
  for (let index = 0; index < argument.length; index++) {
    let backslashes = 0
    while (index < argument.length && argument.charAt(index) === '\\') {
      backslashes += 1
      index += 1
    }
    if (index === argument.length) {
      quoted += '\\'.repeat(backslashes * 2)
    } else if (argument.charAt(index) === '"') {
      quoted += '\\'.repeat(backslashes * 2 + 1) + '"'
    } else {
      quoted += '\\'.repeat(backslashes) + argument.charAt(index)
    }
  }
  return quoted + '"'
}

/**
 * Build the mutable command line accepted by CreateProcessW.
 * @param program - executable argv entry.
 * @param args - remaining argv entries.
 * @returns joined Win32 command line.
 */
export function buildCommandLine(program: string, args: readonly string[]): string {
  return [program, ...args].map(quoteArg).join(' ')
}

function compareWindowsEnvironmentKeys(
  [left]: readonly [string, string],
  [right]: readonly [string, string],
): number {
  const foldedLeft = left.toUpperCase()
  const foldedRight = right.toUpperCase()
  return foldedLeft < foldedRight ? -1 : foldedLeft > foldedRight ? 1 : 0
}

function encodeWindowsEnvironment(env: Readonly<Record<string, string>>): Buffer {
  const entries = Object.entries(env).sort(compareWindowsEnvironmentKeys)
  const strings = entries.map(([key, value]) => `${key}=${value}`)
  return Buffer.from(`${strings.join('\0')}\0\0`, 'utf16le')
}

interface ProcessSpawnOptions {
  /** Executable argv entry passed through CreateProcess. */
  command: string
  /** Arguments excluding the executable. */
  args: readonly string[]
  /** Existing child working directory. */
  cwd: string
}

/** Ordinary process creation inputs used by the local Win32 runner. */
export interface CurrentTokenProcessSpawnOptions extends ProcessSpawnOptions {
  /** Resolved executable path passed separately from the preserved argv entry. */
  applicationName: string
  /** Complete target environment passed without mutating the runner. */
  env: Readonly<Record<string, string>>
  /** Runner CRT descriptors carrying target stdin, stdout, and stderr. */
  stdio: CurrentTokenStdioFileDescriptors
}

/** Runner CRT descriptors whose OS handles become the target standard handles. */
export interface CurrentTokenStdioFileDescriptors {
  stdin: number
  stdout: number
  stderr: number
  /** Optional carrier and target descriptor for the inherited control pipe. */
  control?: 7
}

/** Suspended child assigned to one caller-owned kill-on-close Job before resume. */
export interface SpawnedJobProcess {
  /** Direct child process id. */
  pid: number
  /** Process handle closed by the lifecycle owner. */
  process: NativePtr
  /** Job handle closed by the lifecycle owner. */
  job: NativePtr
}

function freeNative(pointer: NativePtr | undefined): void {
  if (pointer !== undefined) requireKoffi().free(pointer)
}

function closeBestEffort(api: Win32ProcessBindings, handle: NativePtr | null | undefined): void {
  if (!isNullPtr(handle)) api.closeHandle(handle)
}

function createKillOnCloseJob(api: Win32ProcessBindings): NativePtr {
  const job = api.createJobObjectW(null, null)
  if (isNullPtr(job)) throwLastError(api, 'CreateJobObjectW')
  const information = Buffer.alloc(abi.JOBOBJECT_EXTENDED_LIMIT_SIZE)
  information.writeUInt32LE(
    abi.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    abi.JOBOBJECT_EXTENDED_LIMIT_FLAGS_OFFSET,
  )
  if (api.setInformationJobObject(
    job,
    abi.JobObjectExtendedLimitInformation,
    information,
    information.length,
  ) === 0) {
    const win32Code = api.getLastError()
    api.closeHandle(job)
    throwWin32(api, 'SetInformationJobObject', win32Code)
  }
  return job
}

interface ProcessStandardHandles {
  stdin: NativePtr
  stdout: NativePtr
  stderr: NativePtr
  control?: { fileDescriptor: 7; handle: NativePtr }
}

// Koffi exposes PVOID as an unsigned 64-bit bigint on supported Windows hosts.
const UV_INVALID_OS_FILE_HANDLE = 0xffff_ffff_ffff_ffffn
const UV_INVALID_FILE_DESCRIPTOR = 0xffff_ffff_ffff_fffen

function descriptorHandle(api: Win32ProcessBindings, fileDescriptor: number, label: string): NativePtr {
  const handle = api.uvGetOsfhandle(fileDescriptor)
  if (
    isNullPtr(handle)
      || handle === UV_INVALID_OS_FILE_HANDLE
      || handle === UV_INVALID_FILE_DESCRIPTOR
  ) {
    throw new Error(`uv_get_osfhandle returned an invalid handle for target ${label} fd ${String(fileDescriptor)}`)
  }
  return handle
}

function targetCarrierHandles(
  api: CurrentTokenProcessBindings,
  descriptors: CurrentTokenStdioFileDescriptors,
): ProcessStandardHandles {
  return {
    stdin: descriptorHandle(api, descriptors.stdin, 'stdin'),
    stdout: descriptorHandle(api, descriptors.stdout, 'stdout'),
    stderr: descriptorHandle(api, descriptors.stderr, 'stderr'),
    ...descriptors.control === undefined ? {} : {
      control: { fileDescriptor: descriptors.control, handle: descriptorHandle(api, descriptors.control, 'control') },
    },
  }
}

/** Suspended-create, Job-assignment, and resume lifecycle. */
function spawnJobProcess(
  api: Win32ProcessBindings,
  options: ProcessSpawnOptions,
  resolveStdio: () => ProcessStandardHandles,
  create: (startupInfo: NativePtr, processInfo: NativePtr) => number,
): SpawnedJobProcess {
  const job = createKillOnCloseJob(api)
  const enabled: NativePtr[] = []
  let startupInfo: NativePtr | undefined
  let processInfo: NativePtr | undefined
  let controlDescriptorBlock: { pointer: NativePtr; length: number } | undefined
  let created = 0
  let createFailureCode = 0
  try {
    const stdio = resolveStdio()
    const inherited: Array<readonly [NativePtr, string]> = [
      [stdio.stdin, 'stdin'],
      [stdio.stdout, 'stdout'],
      [stdio.stderr, 'stderr'],
    ]
    if (stdio.control !== undefined) inherited.push([stdio.control.handle, 'control'])
    for (const [handle, label] of inherited) {
      if (api.setHandleInformation(handle, abi.HANDLE_FLAG_INHERIT, abi.HANDLE_FLAG_INHERIT) === 0) {
        throwLastError(api, 'SetHandleInformation', `${label} (enable inherit)`)
      }
      enabled.push(handle)
    }
    const controlBytes = stdio.control === undefined
      ? undefined
      : inheritedControlStdio(api, { ...stdio, control: stdio.control })
    if (controlBytes !== undefined) {
      const koffi = requireKoffi()
      controlDescriptorBlock = { pointer: koffi.alloc('uint8', controlBytes.length) as NativePtr, length: controlBytes.length }
      koffi.encode(controlDescriptorBlock.pointer, 'uint8', controlBytes, controlBytes.length)
    }
    startupInfo = allocStartupInfo()
    encodeStartupInfo(startupInfo, {
      cb: abi.STARTUPINFOW_SIZE,
      // Hide initial windows while preserving console inheritance.
      dwFlags: abi.STARTF_USESTDHANDLES | abi.STARTF_USESHOWWINDOW,
      wShowWindow: abi.SW_HIDE,
      hStdInput: stdio.stdin,
      hStdOutput: stdio.stdout,
      hStdError: stdio.stderr,
      ...controlDescriptorBlock === undefined ? {} : {
        cbReserved2: controlDescriptorBlock.length,
        lpReserved2: controlDescriptorBlock.pointer,
      },
    })
    processInfo = allocProcessInfo()
    created = create(startupInfo, processInfo)
    if (created === 0) createFailureCode = api.getLastError()
  } catch (error) {
    freeNative(processInfo)
    api.closeHandle(job)
    throw error
  } finally {
    freeNative(startupInfo)
    freeNative(controlDescriptorBlock?.pointer)
    for (const handle of enabled) {
      // The runner spawns nothing else; cleanup failure must not mask the child.
      api.setHandleInformation(handle, abi.HANDLE_FLAG_INHERIT, 0)
    }
  }
  if (created === 0) {
    freeNative(processInfo)
    api.closeHandle(job)
    throwWin32(
      api,
      'CreateProcessW',
      createFailureCode,
      `command: ${options.command}, cwd: ${options.cwd}`,
    )
  }
  let info: ReturnType<typeof decodeProcessInfo>
  try {
    info = decodeProcessInfo(processInfo)
  } finally {
    freeNative(processInfo)
  }
  if (info.hProcess === null || info.hThread === null) {
    if (info.hProcess !== null) api.terminateProcess(info.hProcess, 1)
    api.closeHandle(job)
    closeBestEffort(api, info.hThread)
    closeBestEffort(api, info.hProcess)
    throw new Error(`CreateProcessW succeeded but returned null process/thread handles (pid ${info.dwProcessId})`)
  }
  if (api.assignProcessToJobObject(job, info.hProcess) === 0) {
    const win32Code = api.getLastError()
    api.terminateProcess(info.hProcess, 1)
    closeBestEffort(api, info.hThread)
    closeBestEffort(api, info.hProcess)
    api.closeHandle(job)
    throwWin32(api, 'AssignProcessToJobObject', win32Code, `pid ${info.dwProcessId}`)
  }
  if (api.resumeThread(info.hThread) === 0xFFFFFFFF) {
    const win32Code = api.getLastError()
    closeBestEffort(api, info.hThread)
    closeBestEffort(api, info.hProcess)
    api.closeHandle(job)
    throwWin32(api, 'ResumeThread', win32Code, `pid ${info.dwProcessId}`)
  }
  closeBestEffort(api, info.hThread)
  return { pid: info.dwProcessId, process: info.hProcess, job }
}

/**
 * Spawn an ordinary process suspended with hidden initial windows, assign its Job, then resume it.
 * @param api - active binding table.
 * @param options - command, cwd, argv, and target carrier descriptors.
 * @returns caller-owned process and Job handles after successful resume.
 */
export function spawnCurrentTokenJobProcess(
  api: CurrentTokenProcessBindings,
  options: CurrentTokenProcessSpawnOptions,
): SpawnedJobProcess {
  const commandLine = buildCommandLine(options.command, options.args)
  const environment = encodeWindowsEnvironment(options.env)
  return spawnJobProcess(api, options, () => targetCarrierHandles(api, options.stdio), (startupInfo, processInfo) =>
    api.createProcessW(
      options.applicationName,
      commandLine,
      null,
      null,
      1,
      abi.CREATE_SUSPENDED | abi.CREATE_UNICODE_ENVIRONMENT,
      environment,
      options.cwd,
      startupInfo,
      processInfo,
    ))
}

/**
 * Verify that an unnamed kill-on-close Job can be created and released now.
 * @param api - active binding table.
 */
export function probeCurrentTokenJobSupport(api: CurrentTokenProcessBindings): void {
  const job = createKillOnCloseJob(api)
  closeHandleChecked(api, job, 'current-token Job capability probe')
}

/**
 * Poll one process handle without blocking the runner event loop.
 * @param api - active binding table.
 * @param process - caller-owned process handle.
 * @returns the direct exit code when signalled, or undefined while running.
 */
export function pollProcessExit(api: Win32ProcessBindings, process: NativePtr): number | undefined {
  const waitResult = api.waitForSingleObject(process, 0)
  if (waitResult === abi.WAIT_TIMEOUT) return undefined
  if (waitResult === 0xFFFFFFFF) throwLastError(api, 'WaitForSingleObject')
  const exitCodeSlot = allocUint32()
  try {
    if (api.getExitCodeProcess(process, exitCodeSlot) === 0) throwLastError(api, 'GetExitCodeProcess')
    return decodeUint32(exitCodeSlot)
  } finally {
    requireKoffi().free(exitCodeSlot)
  }
}

/**
 * Return whether a Job has no active processes.
 * @param api - active binding table.
 * @param job - caller-owned Job handle.
 * @returns true once the Job reports zero active processes.
 */
export function isJobEmpty(api: Win32ProcessBindings, job: NativePtr): boolean {
  const information = Buffer.alloc(abi.JOBOBJECT_BASIC_ACCOUNTING_SIZE)
  if (api.queryInformationJobObject(
    job,
    abi.JobObjectBasicAccountingInformation,
    information,
    information.length,
    null,
  ) === 0) {
    throwLastError(api, 'QueryInformationJobObject', 'active process count')
  }
  return information.readUInt32LE(abi.JOBOBJECT_BASIC_ACCOUNTING_ACTIVE_PROCESSES_OFFSET) === 0
}

/**
 * Terminate every process in a Job.
 * @param api - active binding table.
 * @param job - caller-owned Job handle.
 * @param exitCode - direct Windows exit code assigned to members.
 */
export function terminateJob(api: Win32ProcessBindings, job: NativePtr, exitCode: number): void {
  if (api.terminateJobObject(job, exitCode) === 0) throwLastError(api, 'TerminateJobObject')
}

/**
 * Close a caller-owned handle and report a labelled Win32 failure.
 * @param api - active binding table.
 * @param handle - handle to close.
 * @param detail - lifecycle label for diagnostics.
 */
export function closeHandleChecked(api: Win32ProcessBindings, handle: NativePtr, detail: string): void {
  if (api.closeHandle(handle) === 0) throwLastError(api, 'CloseHandle', detail)
}
