/**
 * File and directory utilities of the command table, all of them over the
 * shell's filesystem. Listings print one entry per line: nothing here is ever
 * a terminal, so the column layout a real `ls` picks for a tty would only be
 * noise in a tool result.
 * @module @deepseek-ai/dsh-experimental-webworker-runtime/src/shell/programs/files
 */

import picomatch from 'picomatch'
import { basename, dirname, resolve } from '../../module-system/posix-path.ts'
import { describeFailure, resolveIn } from '../fs-access.ts'
import type { ShellFileSystem, ShellProgram, ShellStats } from '../types.ts'
import { parseOptions } from './options.ts'

/** Format one entry the way `ls -l` does, with the facts the VFS actually holds. */
function longEntry(stats: ShellStats | undefined, name: string): string {
  const size = String(stats?.size ?? 0).padStart(8)
  const modified = new Date(stats?.mtimeMs ?? 0).toISOString().replace('T', ' ').slice(0, 16)
  return `${stats?.directory === true ? 'drwxr-xr-x' : '-rw-r--r--'} ${size} ${modified} ${name}`
}

const ls: ShellProgram = async (argv, io, state, fs) => {
  const options = parseOptions(argv)
  const operands = options.operands.length > 0 ? options.operands : ['.']
  let status = 0
  for (const [index, operand] of operands.entries()) {
    const path = resolveIn(state.cwd, operand)
    const stats = await fs.stat(path)
    if (stats === undefined) {
      io.err(`ls: ${operand}: No such file or directory\n`)
      status = 2
      continue
    }
    if (operands.length > 1) io.out(`${index > 0 ? '\n' : ''}${operand}:\n`)
    if (!stats.directory) {
      io.out(`${options.flags.has('l') ? longEntry(stats, operand) : operand}\n`)
      continue
    }
    const entries = (await fs.list(path)).filter(entry => options.flags.has('a') || !entry.name.startsWith('.'))
    for (const entry of entries) {
      const shown = options.flags.has('l')
        ? longEntry(await fs.stat(resolve(path, entry.name)), entry.name)
        : entry.name
      io.out(`${shown}\n`)
    }
  }
  return status
}

const find: ShellProgram = async (argv, io, state, fs) => {
  // `find` spells multi-letter predicates with one dash, which the shared
  // option parser would read as bundled short flags; this walk reads them.
  const roots: string[] = []
  let namePattern: string | undefined
  let kind: string | undefined
  let maxDepth = Number.POSITIVE_INFINITY
  const words = argv.slice(1)
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index] as string
    if (word === '-name') { index += 1; namePattern = words[index]; continue }
    if (word === '-type') { index += 1; kind = words[index]; continue }
    if (word === '-maxdepth') { index += 1; maxDepth = Number.parseInt(words[index] ?? '', 10); continue }
    if (word.startsWith('-')) {
      io.err(`find: unsupported predicate ${word}\n`)
      return 2
    }
    roots.push(word)
  }
  const matches = namePattern === undefined ? undefined : picomatch(namePattern, { dot: true })
  let status = 0
  const visit = async (path: string, display: string, depth: number): Promise<void> => {
    const stats = await fs.stat(path)
    if (stats === undefined) {
      io.err(`find: ${display}: No such file or directory\n`)
      status = 1
      return
    }
    const selected = (matches === undefined || matches(basename(display)))
      && (kind === undefined || (kind === 'd') === stats.directory)
    if (selected) io.out(`${display}\n`)
    if (!stats.directory || depth >= maxDepth) return
    for (const entry of await fs.list(path)) {
      await visit(resolve(path, entry.name), `${display === '/' ? '' : display}/${entry.name}`, depth + 1)
    }
  }
  for (const root of roots.length > 0 ? roots : ['.']) await visit(resolveIn(state.cwd, root), root, 0)
  return status
}

const mkdir: ShellProgram = async (argv, io, state, fs) => {
  const options = parseOptions(argv)
  let status = 0
  for (const operand of options.operands) {
    try {
      await fs.mkdir(resolveIn(state.cwd, operand), options.flags.has('p'))
    } catch (error) {
      io.err(`${describeFailure('mkdir', operand, error)}\n`)
      status = 1
    }
  }
  return status
}

const rmdir: ShellProgram = async (argv, io, state, fs) => {
  const options = parseOptions(argv)
  let status = 0
  for (const operand of options.operands) {
    const path = resolveIn(state.cwd, operand)
    if ((await fs.list(path)).length > 0) {
      io.err(`rmdir: ${operand}: Directory not empty\n`)
      status = 1
      continue
    }
    try {
      await fs.remove(path, { recursive: true, force: false })
    } catch (error) {
      io.err(`${describeFailure('rmdir', operand, error)}\n`)
      status = 1
    }
  }
  return status
}

const rm: ShellProgram = async (argv, io, state, fs) => {
  const options = parseOptions(argv)
  const recursive = options.flags.has('r') || options.flags.has('R')
  const force = options.flags.has('f')
  let status = 0
  for (const operand of options.operands) {
    const path = resolveIn(state.cwd, operand)
    const stats = await fs.stat(path)
    if (stats === undefined) {
      if (force) continue
      io.err(`rm: ${operand}: No such file or directory\n`)
      status = 1
      continue
    }
    if (stats.directory && !recursive) {
      io.err(`rm: ${operand}: Is a directory\n`)
      status = 1
      continue
    }
    try {
      await fs.remove(path, { recursive, force })
    } catch (error) {
      io.err(`${describeFailure('rm', operand, error)}\n`)
      status = 1
    }
  }
  return status
}

/** Copy one file or one whole subtree. */
async function copyTree(from: string, to: string, fs: ShellFileSystem): Promise<void> {
  const stats = await fs.stat(from)
  if (stats?.directory !== true) {
    await fs.writeText(to, await fs.readText(from))
    return
  }
  await fs.mkdir(to, true)
  for (const entry of await fs.list(from)) await copyTree(resolve(from, entry.name), resolve(to, entry.name), fs)
}

/** Resolve the real destination of a copy or move: into a directory, or onto a path. */
async function destinationFor(target: string, source: string, fs: ShellFileSystem): Promise<string> {
  return (await fs.stat(target))?.directory === true ? resolve(target, basename(source)) : target
}

const cp: ShellProgram = async (argv, io, state, fs) => {
  const options = parseOptions(argv)
  const sources = options.operands.slice(0, -1)
  const target = options.operands[options.operands.length - 1]
  if (target === undefined || sources.length === 0) {
    io.err('cp: expected a source and a destination\n')
    return 2
  }
  const targetPath = resolveIn(state.cwd, target)
  let status = 0
  for (const source of sources) {
    const sourcePath = resolveIn(state.cwd, source)
    const stats = await fs.stat(sourcePath)
    if (stats === undefined) {
      io.err(`cp: ${source}: No such file or directory\n`)
      status = 1
      continue
    }
    if (stats.directory && !(options.flags.has('r') || options.flags.has('R'))) {
      io.err(`cp: ${source}: Is a directory\n`)
      status = 1
      continue
    }
    try {
      await copyTree(sourcePath, await destinationFor(targetPath, source, fs), fs)
    } catch (error) {
      io.err(`${describeFailure('cp', source, error)}\n`)
      status = 1
    }
  }
  return status
}

const mv: ShellProgram = async (argv, io, state, fs) => {
  const options = parseOptions(argv)
  const sources = options.operands.slice(0, -1)
  const target = options.operands[options.operands.length - 1]
  if (target === undefined || sources.length === 0) {
    io.err('mv: expected a source and a destination\n')
    return 2
  }
  const targetPath = resolveIn(state.cwd, target)
  let status = 0
  for (const source of sources) {
    try {
      await fs.rename(resolveIn(state.cwd, source), await destinationFor(targetPath, source, fs))
    } catch (error) {
      io.err(`${describeFailure('mv', source, error)}\n`)
      status = 1
    }
  }
  return status
}

const touch: ShellProgram = async (argv, io, state, fs) => {
  const options = parseOptions(argv)
  let status = 0
  for (const operand of options.operands) {
    const path = resolveIn(state.cwd, operand)
    try {
      // Rewriting the existing bytes is what advances the VFS timestamp.
      await fs.writeText(path, await fs.stat(path) === undefined ? '' : await fs.readText(path))
    } catch (error) {
      io.err(`${describeFailure('touch', operand, error)}\n`)
      status = 1
    }
  }
  return status
}

const stat: ShellProgram = async (argv, io, state, fs) => {
  const options = parseOptions(argv)
  let status = 0
  for (const operand of options.operands) {
    const path = resolveIn(state.cwd, operand)
    const stats = await fs.stat(path)
    if (stats === undefined) {
      io.err(`stat: ${operand}: No such file or directory\n`)
      status = 1
      continue
    }
    io.out(`${path} ${stats.directory ? 'directory' : 'file'} ${String(stats.size)} ${new Date(stats.mtimeMs).toISOString()}\n`)
  }
  return status
}

const dirnameProgram: ShellProgram = (argv, io) => {
  for (const operand of argv.slice(1)) io.out(`${dirname(operand)}\n`)
  return argv.length > 1 ? 0 : 2
}

const basenameProgram: ShellProgram = (argv, io) => {
  const [, path, suffix] = argv
  if (path === undefined) {
    io.err('basename: expected a path\n')
    return 2
  }
  io.out(`${basename(path, suffix)}\n`)
  return 0
}

/** Refuse a utility whose effect the VFS cannot represent at all. */
const unavailable = (name: string): ShellProgram => (_argv, io) => {
  io.err(`${name}: not available in the worker host\n`)
  return 127
}

/** The file utilities, keyed by the name a command line uses. */
export const FILE_PROGRAMS: Readonly<Record<string, ShellProgram>> = {
  ls,
  find,
  mkdir,
  rmdir,
  rm,
  cp,
  mv,
  touch,
  stat,
  dirname: dirnameProgram,
  basename: basenameProgram,
  // Symbolic links have no representation in the VFS; refusing is honest and
  // keeps a script from believing it created one.
  ln: unavailable('ln'),
  readlink: unavailable('readlink'),
}
