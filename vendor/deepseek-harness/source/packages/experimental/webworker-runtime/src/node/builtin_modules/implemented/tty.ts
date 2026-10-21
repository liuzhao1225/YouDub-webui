/**
 * `node:tty` for the browser worker. The host has no terminal-backed file
 * descriptors, so terminal detection is always false.
 */

/**
 * Test whether a numeric file descriptor refers to a terminal.
 * @param _fd - File descriptor to inspect.
 * @returns Always false in the browser worker.
 */
export function isatty(_fd: number): boolean {
  return false
}

/** CommonJS interop marker: the worker loader hands `default` to default imports (see ../../builtins.ts). */
export const __esModule = true

/** CommonJS default export: the members `require()` hands a caller of this module. */
export default { isatty } satisfies Partial<typeof import('node:tty')>
