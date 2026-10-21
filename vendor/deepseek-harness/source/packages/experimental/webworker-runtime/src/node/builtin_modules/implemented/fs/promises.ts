/**
 * `node:fs/promises` face: the promise members of the VFS bridge, re-exported as
 * named bindings so `import { readFile } from 'node:fs/promises'` resolves. The
 * member set is checked against Node where it is built, on `promises` in
 * `../fs.ts`.
 */
import { Dirent, promises } from '../fs.ts'

/** The promise members of the VFS bridge, as `node:fs/promises` names them. */
export const {
  readFile, writeFile, appendFile, mkdir, mkdtemp, readdir, stat, lstat, realpath, rm, unlink,
  rename, access, chmod, cp, link, open, opendir, truncate, watch, constants,
} = promises

export { Dirent }

/** CommonJS interop marker: the worker loader hands `default` to default imports (see ./builtins.ts). */
export const __esModule = true

export default promises
