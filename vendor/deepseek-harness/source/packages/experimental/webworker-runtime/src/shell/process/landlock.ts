/** Landlock launcher parsing and per-process VFS enforcement for the worker shell. */
import { resolve } from '../../module-system/posix-path.ts'
import { DSH_TMP } from '../../storage/paths.ts'
import { filesystemError } from '../fs-access.ts'
import type { ShellDirent, ShellFileSystem, ShellStats } from '../types.ts'
import type { VirtualExecutable, VirtualExecutableExit } from './virtual-executables.ts'

/** Parsed invocation of the native launcher's unchanged argv grammar. */
export type LandlockInvocation =
  | { readonly kind: 'probe' }
  | {
    readonly kind: 'run'
    readonly readOnly: readonly string[]
    readonly readWrite: readonly string[]
    readonly argv: readonly string[]
  }

/** Launcher-owned failure; callers print its message with the `landlock-run:` prefix. */
export class LandlockLauncherError extends Error {}

/**
 * Parse the native launcher's argv grammar.
 * @param args - Arguments after the launcher executable.
 * @returns A probe or confined-run request.
 */
export function parseLandlockArguments(args: readonly string[]): LandlockInvocation {
  const readOnly: string[] = []
  const readWrite: string[] = []
  for (let index = 0; index < args.length;) {
    const argument = args[index] as string
    if (argument === '--probe') {
      if (args.length !== 1) throw new LandlockLauncherError('usage error: --probe takes no other arguments')
      return { kind: 'probe' }
    }
    if (argument === '--ro' || argument === '--rw') {
      const path = args[index + 1]
      if (path === undefined) throw new LandlockLauncherError(`usage error: ${argument} requires a path`)
      ;(argument === '--ro' ? readOnly : readWrite).push(path)
      index += 2
      continue
    }
    if (argument === '--') {
      const argv = args.slice(index + 1)
      if (argv.length === 0) throw new LandlockLauncherError('usage error: missing `-- <argv>...` command')
      return { kind: 'run', readOnly, readWrite, argv }
    }
    throw new LandlockLauncherError(`usage error: unknown argument: ${argument}`)
  }
  throw new LandlockLauncherError('usage error: missing `-- <argv>...` command')
}

/** Map the host launcher's temp path into the Worker VFS. */
function vfsPath(path: string, cwd: string): string {
  const resolved = resolve(cwd, path)
  const absolute = resolved.length > 1 ? resolved.replace(/\/+$/u, '') : resolved
  if (absolute === '/tmp') return DSH_TMP
  if (absolute.startsWith('/tmp/')) return `${DSH_TMP}${absolute.slice('/tmp'.length)}`
  return absolute
}

/** Whether a normalized path is the root itself or one of its descendants. */
function contains(root: string, path: string): boolean {
  return root === '/' || path === root || path.startsWith(`${root}/`)
}

/** Throw the denial dialect consumed by `dsh-bash-sandbox`. */
function deny(syscall: string, path: string): never {
  throw filesystemError('EACCES', syscall, path)
}

/** Stats for the virtual `/dev/null` file. */
const NULL_STATS: ShellStats = { directory: false, size: 0, mtimeMs: 0 }
const DEV_ROOT = '/dev'
const NULL_PATH = '/dev/null'

/** Build one launcher-owned terminal result. */
function launcherExit(exitCode: number, stdout = '', stderr = ''): VirtualExecutableExit {
  return { kind: 'exit', exitCode, stdout, stderr }
}

/** Convert a parser or grant failure into the native launcher's fatal dialect. */
function launcherFailure(error: unknown): VirtualExecutableExit {
  const detail = error instanceof LandlockLauncherError ? error.message : String(error)
  return launcherExit(125, '', `landlock-run: ${detail}\n`)
}

/**
 * Validate grant roots and create one process-local filesystem guard.
 * @param base - Host-side VFS adapter all permitted calls delegate to.
 * @param invocation - Parsed confined-run request.
 * @param cwd - Launcher's working directory for relative grant paths.
 * @returns A filesystem enforcing only this invocation's grants.
 */
export async function landlockFileSystem(
  base: ShellFileSystem,
  invocation: Extract<LandlockInvocation, { kind: 'run' }>,
  cwd: string,
): Promise<ShellFileSystem> {
  const normalizeGrant = async (path: string): Promise<string> => {
    if (path === '') throw new LandlockLauncherError('cannot open rule path: : No such file or directory')
    const target = vfsPath(path, cwd)
    if (target !== DEV_ROOT && target !== NULL_PATH && await base.stat(target) === undefined) {
      throw new LandlockLauncherError(`cannot open rule path: ${path}: No such file or directory`)
    }
    return target
  }
  const readOnly = await Promise.all(invocation.readOnly.map(normalizeGrant))
  const readWrite = await Promise.all(invocation.readWrite.map(normalizeGrant))
  const readable = [...readOnly, ...readWrite]

  const checkedPath = (path: string, syscall: string): string => {
    const target = vfsPath(path, cwd)
    if (target.startsWith(`${NULL_PATH}/`)) throw filesystemError('ENOTDIR', syscall, path)
    return target
  }
  const readPath = (path: string, syscall: string): string => {
    const target = checkedPath(path, syscall)
    if (!readable.some(root => contains(root, target))) deny(syscall, path)
    return target
  }
  const writePath = (path: string, syscall: string): string => {
    const target = checkedPath(path, syscall)
    if (!readWrite.some(root => contains(root, target))) deny(syscall, path)
    return target
  }

  return {
    stat: async (path: string): Promise<ShellStats | undefined> => {
      const target = readPath(path, 'stat')
      if (target === NULL_PATH) return NULL_STATS
      if (target === DEV_ROOT && !await base.stat(target)) return { directory: true, size: 0, mtimeMs: 0 }
      return await base.stat(target)
    },
    list: async (path: string): Promise<ShellDirent[]> => {
      const target = readPath(path, 'scandir')
      if (target === DEV_ROOT) return [{ name: 'null', directory: false }]
      if (target === NULL_PATH) throw filesystemError('ENOTDIR', 'scandir', path)
      return await base.list(target)
    },
    readText: async (path: string): Promise<string> => {
      const target = readPath(path, 'open')
      return target === NULL_PATH ? '' : await base.readText(target)
    },
    writeText: async (path: string, text: string, append = false): Promise<void> => {
      const target = writePath(path, 'open')
      if (target !== NULL_PATH) await base.writeText(target, text, append)
    },
    mkdir: async (path: string, recursive: boolean): Promise<void> => {
      const target = writePath(path, 'mkdir')
      if (target === NULL_PATH) throw filesystemError('EEXIST', 'mkdir', path)
      await base.mkdir(target, recursive)
    },
    remove: async (path: string, options: { recursive: boolean; force: boolean }): Promise<void> => {
      const target = writePath(path, 'rm')
      if (target === NULL_PATH) deny('rm', path)
      await base.remove(target, options)
    },
    rename: async (from: string, to: string): Promise<void> => {
      const source = writePath(from, 'rename')
      const destination = writePath(to, 'rename')
      if (source === NULL_PATH || destination === NULL_PATH) deny('rename', source === NULL_PATH ? from : to)
      await base.rename(source, destination)
    },
  }
}

/** Virtual executable implementing the native launcher's CLI over VFS grants. */
export const LANDLOCK_EXECUTABLE: VirtualExecutable = {
  name: 'landlock-run',
  async prepare(args, context) {
    try {
      const invocation = parseLandlockArguments(args)
      if (invocation.kind === 'probe') return launcherExit(0, 'landlock: fully enforced\n')
      return {
        kind: 'delegate',
        argv: invocation.argv,
        filesystem: await landlockFileSystem(context.filesystem, invocation, context.cwd),
        missingExecutable: launcherExit(125, '', 'landlock-run: exec failed: No such file or directory\n'),
      }
    } catch (error) {
      return launcherFailure(error)
    }
  },
  runSync(args) {
    try {
      const invocation = parseLandlockArguments(args)
      return invocation.kind === 'probe'
        ? launcherExit(0, 'landlock: fully enforced\n')
        : { kind: 'asynchronous' }
    } catch (error) {
      return launcherFailure(error)
    }
  },
}
