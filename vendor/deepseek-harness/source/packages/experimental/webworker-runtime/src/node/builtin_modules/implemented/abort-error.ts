/** Build the Node-style cancellation error shared by abortable builtin APIs. */

/**
 * Create an `AbortError` carrying Node's stable error code.
 * @param reason - Optional AbortSignal reason exposed as the error cause.
 * @returns A Node-compatible abort error.
 */
export function abortError(reason?: unknown): Error & { code: string; cause?: unknown } {
  const error = new Error('The operation was aborted') as Error & { code: string; cause?: unknown }
  error.name = 'AbortError'
  error.code = 'ABORT_ERR'
  if (reason !== undefined) error.cause = reason
  return error
}
