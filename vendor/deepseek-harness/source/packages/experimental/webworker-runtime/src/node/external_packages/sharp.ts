/**
 * `sharp` stub: native image transcoding has no browser counterpart in this
 * layer. Attachment plugins mount; a resize attempt reports the gap.
 */
import { notImplementedFail } from '../notImplementedFail.ts'

/** Image processing has no worker counterpart; the call refuses. */
const sharp = notImplementedFail('sharp', 'default')

/** CommonJS interop marker: the worker loader hands `default` to default imports (see ./builtins.ts). */
export const __esModule = true

export default sharp
