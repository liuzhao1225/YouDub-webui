/**
 * Shell builtins: the programs that read or change the shell's own state
 * (directory, environment, exit status) rather than the filesystem.
 * @module @deepseek-ai/dsh-experimental-webworker-runtime/src/shell/programs/builtins
 */

import { readVariable } from '../expand.ts'
import { resolveIn } from '../fs-access.ts'
import type { ShellProgram, ShellStats } from '../types.ts'
import { parseOptions } from './options.ts'

/** Status a command reports when a signal ended it, as a shell renders `128 + SIGINT`. */
const SIGNAL_EXIT_STATUS = 130

const cd: ShellProgram = async (argv, io, state, fs) => {
  const target = argv[1] ?? state.environment['HOME'] ?? '/'
  const path = target === '-' ? state.variables['OLDPWD'] ?? state.cwd : resolveIn(state.cwd, target)
  const stats = await fs.stat(path)
  if (stats === undefined) {
    io.err(`cd: ${target}: No such file or directory\n`)
    return 1
  }
  if (!stats.directory) {
    io.err(`cd: ${target}: Not a directory\n`)
    return 1
  }
  state.variables['OLDPWD'] = state.cwd
  state.cwd = path
  // `$PWD` is what scripts read back, so it has to follow the real directory.
  if ('PWD' in state.environment) state.environment['PWD'] = path
  return 0
}

const pwd: ShellProgram = (_argv, io, state) => {
  io.out(`${state.cwd}\n`)
  return 0
}

const exportProgram: ShellProgram = (argv, io, state) => {
  const options = parseOptions(argv)
  if (options.operands.length === 0) {
    for (const [name, value] of Object.entries(state.environment).sort()) io.out(`declare -x ${name}="${value}"\n`)
    return 0
  }
  for (const operand of options.operands) {
    const separator = operand.indexOf('=')
    if (separator < 0) {
      // Exporting an existing shell variable moves it into the environment.
      state.environment[operand] = state.variables[operand] ?? state.environment[operand] ?? ''
      continue
    }
    state.environment[operand.slice(0, separator)] = operand.slice(separator + 1)
  }
  return 0
}

const unset: ShellProgram = (argv, _io, state) => {
  const removed = new Set(argv.slice(1))
  const without = (source: Record<string, string>): Record<string, string> =>
    Object.fromEntries(Object.entries(source).filter(([name]) => !removed.has(name)))
  state.environment = without(state.environment)
  state.variables = without(state.variables)
  return 0
}

const env: ShellProgram = (_argv, io, state) => {
  for (const [name, value] of Object.entries(state.environment).sort()) io.out(`${name}=${value}\n`)
  return 0
}

const exitProgram: ShellProgram = (argv, _io, state) => {
  const status = argv[1] === undefined ? state.lastStatus : Number.parseInt(argv[1], 10) || 0
  state.exitRequested = status
  return status
}

/** `test` / `[`: the file and string predicates a generated command line uses. */
const test: ShellProgram = async (argv, io, state, fs) => {
  const words = argv[0] === '[' ? argv.slice(1, argv[argv.length - 1] === ']' ? -1 : undefined) : argv.slice(1)
  const status = (value: boolean): number => value ? 0 : 1
  const statOf = async (operand: string): Promise<ShellStats | undefined> => await fs.stat(resolveIn(state.cwd, operand))
  if (words.length === 1) return status((words[0] as string) !== '')
  if (words.length === 2) {
    const operator = words[0] as string
    const operand = words[1] ?? ''
    switch (operator) {
      case '-e': return status(await statOf(operand) !== undefined)
      case '-f': return status((await statOf(operand))?.directory === false)
      case '-d': return status((await statOf(operand))?.directory === true)
      case '-s': return status(((await statOf(operand))?.size ?? 0) > 0)
      case '-r': case '-w': return status(await statOf(operand) !== undefined)
      case '-z': return status(operand === '')
      case '-n': return status(operand !== '')
      case '!': return status(operand === '')
      default:
        io.err(`test: ${operator}: unsupported unary operator\n`)
        return 2
    }
  }
  if (words.length === 3) {
    const [left, operator, right] = words as [string, string, string]
    switch (operator) {
      case '=': case '==': return status(left === right)
      case '!=': return status(left !== right)
      case '-eq': return status(Number(left) === Number(right))
      case '-ne': return status(Number(left) !== Number(right))
      case '-lt': return status(Number(left) < Number(right))
      case '-le': return status(Number(left) <= Number(right))
      case '-gt': return status(Number(left) > Number(right))
      case '-ge': return status(Number(left) >= Number(right))
      default:
        io.err(`test: ${operator}: unsupported binary operator\n`)
        return 2
    }
  }
  io.err('test: unsupported expression\n')
  return 2
}

const sleep: ShellProgram = async (argv, io, state) => {
  const seconds = Number.parseFloat(argv[1] ?? '')
  if (!Number.isFinite(seconds) || seconds < 0) {
    io.err(`sleep: invalid time interval '${argv[1] ?? ''}'\n`)
    return 2
  }
  // A killed command must settle at once: waiting out the full interval would
  // keep the caller's process handle open long after its signal arrived.
  const killed = await new Promise<boolean>((settle) => {
    const timer = setTimeout(() => {
      state.signal?.removeEventListener('abort', onAbort)
      settle(false)
    }, seconds * 1000)
    function onAbort(): void {
      clearTimeout(timer)
      settle(true)
    }
    if (state.signal?.aborted === true) onAbort()
    else state.signal?.addEventListener('abort', onAbort, { once: true })
  })
  return killed ? SIGNAL_EXIT_STATUS : 0
}

const date: ShellProgram = (_argv, io) => {
  io.out(`${new Date().toISOString()}\n`)
  return 0
}

const seq: ShellProgram = (argv, io) => {
  const numbers = argv.slice(1).map(value => Number.parseInt(value, 10))
  const [first, second, third] = numbers
  const from = numbers.length > 1 ? first as number : 1
  const step = numbers.length > 2 ? second as number : 1
  const to = numbers.length > 2 ? third as number : numbers.length > 1 ? second as number : first
  if (to === undefined || !Number.isFinite(to) || step === 0) {
    io.err('seq: expected numeric bounds\n')
    return 2
  }
  for (let value = from; step > 0 ? value <= to : value >= to; value += step) io.out(`${String(value)}\n`)
  return 0
}

/** `printenv NAME`, which scripts prefer over `echo $NAME` when the name is computed. */
const printenv: ShellProgram = (argv, io, state) => {
  const name = argv[1]
  if (name === undefined) {
    for (const [key, value] of Object.entries(state.environment).sort()) io.out(`${key}=${value}\n`)
    return 0
  }
  const value = readVariable(state, name)
  if (value === undefined) return 1
  io.out(`${value}\n`)
  return 0
}

/** The state builtins, keyed by the name a command line uses. */
export const BUILTIN_PROGRAMS: Readonly<Record<string, ShellProgram>> = {
  cd,
  pwd,
  export: exportProgram,
  unset,
  env,
  printenv,
  exit: exitProgram,
  test,
  '[': test,
  sleep,
  date,
  seq,
  'true': () => 0,
  'false': () => 1,
  ':': () => 0,
}
