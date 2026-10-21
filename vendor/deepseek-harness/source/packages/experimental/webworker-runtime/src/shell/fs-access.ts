/**
 * The in-host filesystem for shell runs: {@link ShellFileSystem} straight over
 * the mounted VFS, plus the path and diagnostic helpers every program shares.
 *
 * This implementation answers from memory. A command running in its own
 * worker uses the message-backed one (`./process/child.ts`), which this one
 * serves from the host side.
 * @module @deepseek-ai/dsh-experimental-webworker-runtime/src/shell/fs-access
 */

import { resolve } from '../module-system/posix-path.ts'
import { requireActiveVfs } from '../storage/active.ts'
import type { VfsError, VfsStats } from '../storage/types.ts'
import type { ShellDirent, ShellFileSystem, ShellStats } from './types.ts'

/**
 * Resolve one shell word into an absolute VFS path.
 * @param cwd - the shell's working directory.
 * @param path - absolute or relative path as the command line spelled it.
 * @returns the absolute normalized path.
 */
export function resolveIn(cwd: string, path: string): string {
  return resolve(cwd, path)
}

/**
 * Restate a filesystem failure the way a shell utility reports it, so the model
 * reads `cat: /dsh/none: No such file or directory` instead of a Node error
 * string.
 * @param program - the utility's name, used as the message prefix.
 * @param path - the path the utility was working on.
 * @param error - the failure the filesystem raised.
 * @returns the single-line diagnostic, without a trailing newline.
 */
export function describeFailure(program: string, path: string, error: unknown): string {
  const code = (error as Partial<VfsError>).code
  const reason = code === 'ENOENT'
    ? 'No such file or directory'
    : code === 'ENOTDIR'
      ? 'Not a directory'
      : code === 'EISDIR'
        ? 'Is a directory'
        : code === 'ENOTEMPTY'
          ? 'Directory not empty'
          : code === 'EEXIST'
            ? 'File exists'
            : error instanceof Error ? error.message : String(error)
  return `${program}: ${path}: ${reason}`
}

/**
 * Build a Node-shaped filesystem error, for the conditions this layer detects
 * itself and for the worker transport, which can carry a code but not a class.
 * @param code - the Node error code (`ENOENT`, `EISDIR`, …).
 * @param syscall - the operation that failed.
 * @param path - the path it failed on.
 * @returns the error to throw.
 */
export function filesystemError(code: string, syscall: string, path: string): VfsError {
  const reason = code === 'EACCES' ? 'permission denied' : `${syscall} failed`
  const error = new Error(`${code}: ${reason}, ${syscall} '${path}'`) as VfsError
  error.code = code
  error.path = path
  error.syscall = syscall
  return error
}

/** Project VFS stats onto the facts a program reads. */
function statsOf(stats: VfsStats): ShellStats {
  return { directory: stats.isDirectory(), size: stats.size, mtimeMs: stats.mtimeMs }
}

/**
 * The filesystem backed by the VFS mounted in this thread.
 * @returns the in-host {@link ShellFileSystem}.
 */
export function hostFileSystem(): ShellFileSystem {
  const vfs = (): ReturnType<typeof requireActiveVfs> => requireActiveVfs()
  const stat = (path: string): Promise<ShellStats | undefined> => {
    try {
      return Promise.resolve(statsOf(vfs().statSync(path) as VfsStats))
    } catch {
      // Absence is the answer callers branch on; every other failure mode of
      // the in-memory backend is also "this path holds nothing readable".
      return Promise.resolve(undefined)
    }
  }
  // Several members take no await: the face is asynchronous because a process
  // worker's filesystem is, while this backend answers from memory.
  return {
    stat,
    list: async (path: string): Promise<ShellDirent[]> => {
      const names = [...vfs().readdirSync(path) as string[]].sort()
      const entries: ShellDirent[] = []
      for (const name of names) {
        entries.push({ name, directory: (await stat(resolve(path, name)))?.directory ?? false })
      }
      return entries
    },
    readText: async (path: string): Promise<string> => {
      if ((await stat(path))?.directory === true) throw filesystemError('EISDIR', 'read', path)
      return vfs().readFileSync(path, 'utf8') as string
    },
    writeText: (path: string, text: string, append = false): Promise<void> => {
      if (append) vfs().appendFileSync(path, text)
      else vfs().writeFileSync(path, text)
      return Promise.resolve()
    },
    mkdir: (path: string, recursive: boolean): Promise<void> => {
      vfs().mkdirSync(path, { recursive })
      return Promise.resolve()
    },
    remove: (path: string, options: { recursive: boolean; force: boolean }): Promise<void> => {
      vfs().rmSync(path, options)
      return Promise.resolve()
    },
    rename: (from: string, to: string): Promise<void> => {
      vfs().renameSync(from, to)
      return Promise.resolve()
    },
  }
}
