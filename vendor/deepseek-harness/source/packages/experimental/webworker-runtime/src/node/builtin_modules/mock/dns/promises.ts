/**
 * `node:dns/promises` stub. The static WebWorker preview has no DNS resolver;
 * reaching public-address preflight must fail loud instead of inventing an
 * address or bypassing the native HTTP provider's SSRF policy.
 */
import { notImplementedFail } from '../../../notImplementedFail.ts'

const MODULE = 'node:dns/promises'

/** DNS lookup (unavailable in the worker host). */
export const lookup: typeof import('node:dns/promises').lookup = notImplementedFail(MODULE, 'lookup')

/** CommonJS interop marker: the worker loader hands `default` to default imports. */
export const __esModule = true

/** The `node:dns/promises` declarations this module stands in for. */
type NodeFace = Partial<typeof import('node:dns/promises')>

/** CommonJS default export: the members `require()` hands a caller of this module. */
export default { lookup } satisfies NodeFace
