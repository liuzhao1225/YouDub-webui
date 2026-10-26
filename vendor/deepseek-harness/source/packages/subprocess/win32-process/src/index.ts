/** Shared low-level Win32 process, stdio, and Job Object primitives. */

export * from './errors.ts'
export {
  allocUint32,
  decodeUint32,
  isNullPtr,
  loadWin32ProcessBindings,
  throwLastError,
  throwWin32,
} from './ffi.ts'
export type {
  CurrentTokenProcessBindings,
  NativePtr,
  Win32ProcessBindings,
} from './ffi.ts'
export {
  closeHandleChecked,
  isJobEmpty,
  pollProcessExit,
  probeCurrentTokenJobSupport,
  spawnCurrentTokenJobProcess,
  terminateJob,
} from './process.ts'
export type {
  CurrentTokenStdioFileDescriptors,
  CurrentTokenProcessSpawnOptions,
  SpawnedJobProcess,
} from './process.ts'
