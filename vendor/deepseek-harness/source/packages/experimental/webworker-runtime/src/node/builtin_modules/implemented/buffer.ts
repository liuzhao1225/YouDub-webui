/**
 * `node:buffer` for the worker, backed by the `buffer` npm package (feross), and
 * the matching `globalThis.Buffer` install. Node code treats Buffer as ambient,
 * so the global must exist before any host module evaluates.
 */
import { Buffer, kMaxLength } from 'buffer'

Object.defineProperty(globalThis, 'Buffer', { value: Buffer, writable: true, configurable: true })

export { Buffer, kMaxLength }

/**
 * Size limits, as `node:buffer` publishes them. The npm package exposes only
 * `kMaxLength`, so the string bound is Node's own value for a 64-bit build.
 */
export const constants = {
  MAX_LENGTH: kMaxLength,
  MAX_STRING_LENGTH: 536_870_888,
}

/** CommonJS interop marker: the worker loader hands `default` to default imports (see ./builtins.ts). */
export const __esModule = true

/** The `node:buffer` declarations this module stands in for. */
type NodeFace = Partial<typeof import('node:buffer')>

/** CommonJS default export: the members `require()` hands a caller of this module. */
export default { Buffer, constants, kMaxLength } satisfies NodeFace
