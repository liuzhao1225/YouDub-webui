/**
 * `@vscode/ripgrep` stub. The package's only export is the binary path, read at
 * module scope by search plugins; the path stays a plain string so construction
 * succeeds, and the loud failure comes from the child_process stub when something
 * tries to run it.
 */

/** Path the search plugins would spawn; nothing can execute it in a browser. */
export const rgPath = '/dsh/bin/rg'

/** CommonJS interop marker: the worker loader hands `default` to default imports (see ./builtins.ts). */
export const __esModule = true

/** CommonJS default export: the members `require()` hands a caller of this module. */
export default { rgPath }
