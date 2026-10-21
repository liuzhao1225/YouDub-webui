/**
 * `node-pty` stub: pseudo-terminals belong to the excluded surface. Terminal
 * plugins mount so their tools stay visible; spawning reports the gap.
 */
import { notImplementedFail } from '../notImplementedFail.ts'

const MODULE = 'node-pty'

/** Spawn a pseudo-terminal (unavailable). */
export const spawn = notImplementedFail(MODULE, 'spawn')

/** Open a pseudo-terminal pair (unavailable). */
export const open = notImplementedFail(MODULE, 'open')

/** CommonJS interop marker: the worker loader hands `default` to default imports (see ./builtins.ts). */
export const __esModule = true

/** CommonJS default export: the members `require()` hands a caller of this module. */
export default { spawn, open }
