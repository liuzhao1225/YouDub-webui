/**
 * `koffi` stub: the FFI bridge the Windows ACL layer and the Landlock launcher
 * use. Type constructors return opaque tokens because the ACL module builds its
 * pointer and struct descriptors at module scope — the plugin must mount. Every
 * entry that would actually cross into native code is loud; on this platform
 * none of it is reachable (`process.platform === 'linux'`, no sandbox).
 */
import { notImplementedFail } from '../notImplementedFail.ts'

const MODULE = 'koffi'

/** Opaque type descriptor standing in for a koffi type handle. */
interface KoffiType {
  readonly __dshKoffiType: string
  /** Byte size under the x64 ABI; struct layout guards compare against it. */
  readonly size: number
  /** Byte alignment under the x64 ABI. */
  readonly alignment: number
}

/** Primitive sizes koffi's own x64 ABI reports. */
const PRIMITIVES: Record<string, number> = {
  void: 0,
  bool: 1,
  char: 1,
  uchar: 1,
  int8: 1,
  uint8: 1,
  short: 2,
  ushort: 2,
  int16: 2,
  uint16: 2,
  int: 4,
  uint: 4,
  int32: 4,
  uint32: 4,
  float: 4,
  float32: 4,
  long: 8,
  ulong: 8,
  longlong: 8,
  ulonglong: 8,
  int64: 8,
  uint64: 8,
  double: 8,
  float64: 8,
  str: 8,
  str16: 8,
}

const token = (label: string, size: number, alignment = Math.min(size, 8) || 1): KoffiType =>
  ({ __dshKoffiType: label, size, alignment })

const typeOf = (target: unknown): KoffiType => {
  if (typeof target === 'string') {
    const size = PRIMITIVES[target]
    if (size === undefined) throw new Error(`web-preview: koffi type "${target}" is unknown to the stub`)
    return token(target, size)
  }
  const descriptor = target as KoffiType | undefined
  if (descriptor?.__dshKoffiType === undefined) {
    throw new Error(`web-preview: koffi type ${JSON.stringify(target)} is not a stub descriptor`)
  }
  return descriptor
}

const describe = (target: unknown): string =>
  typeof target === 'string' ? target : (target as KoffiType | undefined)?.__dshKoffiType ?? 'anonymous'

/**
 * Pointer type descriptor.
 * @param target - pointee type name or descriptor.
 * @returns the descriptor token.
 */
function pointer(target: unknown): KoffiType {
  return token(`pointer(${describe(target)})`, 8)
}

/**
 * Struct type descriptor. The size and alignment are computed with the same
 * padding rules koffi uses on x64, because the Windows ACL layer compares them
 * against its own header probe at module scope.
 * @param name - struct name, or the field record when the name is omitted.
 * @param fields - field name → type record.
 * @returns the descriptor token.
 */
function struct(name: unknown, fields?: Record<string, unknown>): KoffiType {
  const members = (typeof name === 'string' ? fields : name as Record<string, unknown>) ?? {}
  let offset = 0
  let alignment = 1
  for (const member of Object.values(members)) {
    const type = typeOf(member)
    alignment = Math.max(alignment, type.alignment)
    offset = Math.ceil(offset / type.alignment) * type.alignment + type.size
  }
  const size = Math.ceil(offset / alignment) * alignment
  return token(`struct(${typeof name === 'string' ? name : 'anonymous'})`, size, alignment)
}

/**
 * Array type descriptor.
 * @param target - element type.
 * @param length - element count.
 * @returns the descriptor token.
 */
function array(target: unknown, length: number): KoffiType {
  const element = typeOf(target)
  return token(`array(${element.__dshKoffiType}, ${String(length)})`, element.size * length, element.alignment)
}

/**
 * Opaque type descriptor.
 * @param name - type name.
 * @returns the descriptor token.
 */
function opaque(name?: string): KoffiType {
  return token(`opaque(${name ?? 'anonymous'})`, 0, 1)
}

/** Primitive type table; members carry their x64 sizes. */
const types: Record<string, KoffiType> = new Proxy({}, {
  get: (_target, property) => typeOf(String(property)),
  has: property => typeof property === 'string' && property in PRIMITIVES,
})

/** The koffi face its consumers read; every call refuses. */
const koffi = {
  pointer,
  struct,
  array,
  opaque,
  types,
  alias: (name: string, target: unknown): KoffiType => {
    const type = typeOf(target)
    return token(`alias(${name})`, type.size, type.alignment)
  },
  sizeof: (target: unknown): number => typeOf(target).size,
  alignof: (target: unknown): number => typeOf(target).alignment,
  load: notImplementedFail(MODULE, 'load'),
  alloc: notImplementedFail(MODULE, 'alloc'),
  free: notImplementedFail(MODULE, 'free'),
  decode: notImplementedFail(MODULE, 'decode'),
  encode: notImplementedFail(MODULE, 'encode'),
  address: notImplementedFail(MODULE, 'address'),
  register: notImplementedFail(MODULE, 'register'),
  unregister: notImplementedFail(MODULE, 'unregister'),
  call: notImplementedFail(MODULE, 'call'),
}

export { pointer, struct, array, opaque, types }

/** CommonJS interop marker: the worker loader hands `default` to default imports (see ./builtins.ts). */
export const __esModule = true

export default koffi
