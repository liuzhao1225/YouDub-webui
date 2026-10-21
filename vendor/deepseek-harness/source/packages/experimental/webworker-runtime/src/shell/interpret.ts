/**
 * The interpreter: it walks the parsed command line and runs the command table
 * against the VFS. Structure (`;` `&` `|` `|&` `&&` `||`, subshells, groups,
 * redirections, prefix assignments) is honored here; what a command *does*
 * belongs to its program in `./programs/`.
 *
 * Output is text, not streams: every program is a JavaScript function that
 * returns before the next one runs, so a pipeline hands a string along instead
 * of plumbing byte streams a browser worker has no way to schedule between.
 * @module @deepseek-ai/dsh-experimental-webworker-runtime/src/shell/interpret
 */

import { parseShell } from '@yarnpkg/parsers'
import type { Command, CommandChain, CommandLine, RedirectArgument, ShellLine, ValueArgument } from './ast.ts'
import { expandArgument, isGlobPattern } from './expand.ts'
import type { ExpansionContext } from './expand.ts'
import { describeFailure, hostFileSystem, resolveIn } from './fs-access.ts'
import { standardPrograms } from './programs/index.ts'
import type { ShellFileSystem, ShellIo, ShellProgram, ShellRunOutcome, ShellState } from './types.ts'

/** Status a command line reports once the caller's abort signal has fired. */
const ABORTED_STATUS = 130

/** Status of a command name the table does not hold, as POSIX shells report it. */
const NOT_FOUND_STATUS = 127

/** Nesting limit for `$( … )`; a deeper line is a runaway, not a command. */
const MAX_SUBSTITUTION_DEPTH = 16

/** Everything one `bash -c` invocation needs. */
export interface ShellRunOptions {
  /** Working directory the line starts in. */
  cwd: string
  /** Environment the line starts with. */
  env: Record<string, string>
  /** Standard input contents; absent means empty. */
  stdin?: string | undefined
  /** Cancellation: an aborted line stops before its next command. */
  signal?: AbortSignal | undefined
  /**
   * The filesystem this run acts on; defaults to the VFS mounted in this
   * thread. A run inside a process worker passes the message-backed one.
   */
  fs?: ShellFileSystem | undefined
  /**
   * Called with each write as it happens, before the run settles. The returned
   * outcome still carries the complete text; this only lets a caller that
   * reports progress (a background job's incremental reads) see output while
   * the line is still running.
   */
  onOutput?: ((stream: 'stdout' | 'stderr', text: string) => void) | undefined
}

/** Accumulates one output stream. */
interface Sink {
  write: (text: string) => void
}

/** A sink over a string buffer, for pipelines and command substitution. */
function buffer(): Sink & { text(): string } {
  const chunks: string[] = []
  return {
    write: (text: string) => { chunks.push(text) },
    text: () => chunks.join(''),
  }
}

/**
 * Run one shell command line to completion.
 * @param source - the command source, exactly as `bash -c` would receive it.
 * @param options - starting directory, environment, standard input, cancellation, filesystem, output callback.
 * @returns the exit status and the complete standard output and standard error.
 */
export async function runShellCommand(source: string, options: ShellRunOptions): Promise<ShellRunOutcome> {
  const run = startRun(options)
  let line: ShellLine
  try {
    line = parseShell(source, { isGlobPattern })
  } catch (error) {
    run.io.err(`bash: syntax error: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}\n`)
    return run.settle(2)
  }
  const interpreter = new Interpreter(standardPrograms(), options.fs ?? hostFileSystem(), options.signal)
  return run.settle(await interpreter.line(line, run.state, run.io))
}

/**
 * Run one program directly, without a command line to parse.
 *
 * This is the path for an argv the caller already has in pieces — a spawn that
 * names a program instead of handing `bash` a script — so nothing re-quotes
 * words that were never quoted in the first place.
 * @param argv - the program name at index 0, then its arguments.
 * @param options - starting directory, environment, standard input, cancellation, filesystem, output callback.
 * @returns the exit status and the complete standard output and standard error.
 */
export async function runShellProgram(argv: readonly string[], options: ShellRunOptions): Promise<ShellRunOutcome> {
  const run = startRun(options)
  const name = argv[0]
  const program = name === undefined ? undefined : standardPrograms().get(name)
  if (name === undefined || program === undefined) {
    run.io.err(`bash: ${name ?? ''}: command not found\n`)
    return run.settle(NOT_FOUND_STATUS)
  }
  if (options.signal?.aborted === true) return run.settle(ABORTED_STATUS)
  try {
    return run.settle(await program(argv, run.io, run.state, options.fs ?? hostFileSystem()))
  } catch (error) {
    run.io.err(`bash: ${name}: ${error instanceof Error ? error.message : String(error)}\n`)
    return run.settle(1)
  }
}

/** Build the state, the sinks, and the settlement one run reports through. */
function startRun(options: ShellRunOptions): {
  state: ShellState
  io: ShellIo
  settle: (exitCode: number) => ShellRunOutcome
} {
  const stdout = buffer()
  const stderr = buffer()
  const report = options.onOutput
  return {
    state: {
      cwd: options.cwd,
      environment: { ...options.env },
      variables: {},
      lastStatus: 0,
      exitRequested: undefined,
      signal: options.signal,
    },
    io: {
      stdin: options.stdin ?? '',
      out: (text: string) => {
        stdout.write(text)
        report?.('stdout', text)
      },
      err: (text: string) => {
        stderr.write(text)
        report?.('stderr', text)
      },
    },
    settle: (exitCode: number) => ({ exitCode, stdout: stdout.text(), stderr: stderr.text() }),
  }
}

/** One interpretation pass; holds what every nested command shares. */
class Interpreter {
  constructor(
    private readonly programs: ReadonlyMap<string, ShellProgram>,
    private readonly fs: ShellFileSystem,
    private readonly signal: AbortSignal | undefined,
    private readonly depth = 0,
  ) {}

  /**
   * Run every command of one line, left to right.
   * @param line - the parsed line.
   * @param state - shell state the line reads and mutates.
   * @param io - standard input and the output sinks.
   * @returns the status of the last command that ran.
   */
  async line(line: ShellLine, state: ShellState, io: ShellIo): Promise<number> {
    let status = state.lastStatus
    for (const entry of line) {
      if (this.signal?.aborted === true) return ABORTED_STATUS
      // `&` starts no background job here: the worker has no scheduler that
      // could run one, so a backgrounded command runs to completion in place.
      status = await this.commandLine(entry.command, state, io)
      state.lastStatus = status
      if (state.exitRequested !== undefined) return state.exitRequested
    }
    return status
  }

  /**
   * Run one `&&` / `||` chain.
   *
   * The grammar nests these to the right, while a shell evaluates them left to
   * right: `false && a || b` runs `b`. Flattening first is what makes the
   * skipped `&&` hand its status to the following `||` instead of taking the
   * whole remainder of the line with it.
   */
  private async commandLine(commandLine: CommandLine, state: ShellState, io: ShellIo): Promise<number> {
    const links: { type: '&&' | '||'; chain: CommandChain }[] = []
    for (let current = commandLine.then; current !== undefined; current = current.line.then) {
      links.push({ type: current.type, chain: current.line.chain })
    }
    let status = await this.pipeline(commandLine.chain, state, io)
    state.lastStatus = status
    for (const link of links) {
      if (state.exitRequested !== undefined) return status
      if (link.type === '&&' ? status !== 0 : status === 0) continue
      status = await this.pipeline(link.chain, state, io)
      state.lastStatus = status
    }
    return status
  }

  /** Run one `|` / `|&` pipeline; its status is the last stage's. */
  private async pipeline(chain: CommandChain, state: ShellState, io: ShellIo): Promise<number> {
    const stages: { command: CommandChain; mergesStderr: boolean }[] = []
    for (let current: CommandChain | undefined = chain; current !== undefined;) {
      const link: CommandChain['then'] = current.then
      stages.push({ command: current, mergesStderr: link?.type === '|&' })
      current = link?.chain
    }
    let input = io.stdin
    let status = 0
    for (const [index, stage] of stages.entries()) {
      if (this.signal?.aborted === true) return ABORTED_STATUS
      const last = index === stages.length - 1
      const piped = buffer()
      const stageIo: ShellIo = last
        ? { stdin: input, out: io.out, err: io.err }
        : { stdin: input, out: piped.write, err: stage.mergesStderr ? piped.write : io.err }
      status = await this.command(stage.command, state, stageIo)
      if (!last) input = piped.text()
      if (state.exitRequested !== undefined) return status
    }
    return status
  }

  /** Run one command node: a program call, a subshell, a group, or bare assignments. */
  private async command(command: Command, state: ShellState, io: ShellIo): Promise<number> {
    switch (command.type) {
      case 'envs':
        for (const env of command.envs) assign(state, env.name, await this.assignedValue(env.args[0], state))
        return 0
      case 'subshell': {
        // A subshell sees a copy: its `cd` and its assignments die with it.
        const nested = { ...state, environment: { ...state.environment }, variables: { ...state.variables } }
        return await this.redirected(command.args, state, io, async inner => await this.line(command.subshell, nested, inner))
      }
      case 'group':
        return await this.redirected(command.args, state, io, async inner => await this.line(command.group, state, inner))
      case 'command':
        return await this.program(command, state, io)
    }
  }

  /** Expand a command's words and run the program they name. */
  private async program(command: Extract<Command, { type: 'command' }>, state: ShellState, io: ShellIo): Promise<number> {
    const argv: string[] = []
    const redirections: RedirectArgument[] = []
    for (const argument of command.args) {
      if (argument.type === 'redirection') {
        redirections.push(argument)
        continue
      }
      argv.push(...await expandArgument(argument, this.context(state)))
    }
    const prefix: Record<string, string> = {}
    for (const env of command.envs) prefix[env.name] = await this.assignedValue(env.args[0], state)

    if (argv.length === 0) {
      for (const [name, value] of Object.entries(prefix)) assign(state, name, value)
      return 0
    }
    // A prefixed command sees the assignments as environment for its run only,
    // which also means it cannot change the caller's directory.
    const scope = Object.keys(prefix).length === 0
      ? state
      : { ...state, environment: { ...state.environment, ...prefix } }

    const name = argv[0] as string
    const program = this.programs.get(name)
    if (program === undefined) {
      io.err(`bash: ${name}: command not found\n`)
      return NOT_FOUND_STATUS
    }
    return await this.redirected(redirections, state, io, async (inner) => {
      try {
        return await program(argv, inner, scope, this.fs)
      } catch (error) {
        // A program's own defect must not take the whole worker down with it.
        inner.err(`bash: ${name}: ${error instanceof Error ? error.message : String(error)}\n`)
        return 1
      }
    })
  }

  /**
   * Apply redirections around one body, then restore nothing: every sink is a
   * value, so the caller's own `io` is untouched by construction.
   */
  private async redirected(
    redirections: readonly RedirectArgument[],
    state: ShellState,
    io: ShellIo,
    body: (io: ShellIo) => Promise<number>,
  ): Promise<number> {
    let stdin = io.stdin
    let out = io.out
    let err = io.err
    // Every file write this redirection set started, awaited before the
    // command's status is reported: a `> file` must be complete on return.
    const writes: Promise<void>[] = []
    for (const redirection of redirections) {
      const targets: string[] = []
      for (const argument of redirection.args) targets.push(...await expandArgument(argument, this.context(state)))
      const target = targets[0]
      if (target === undefined || targets.length > 1) {
        io.err('bash: ambiguous redirect\n')
        return 1
      }
      try {
        switch (redirection.subtype) {
          case '<':
            stdin = await this.fs.readText(resolveIn(state.cwd, target))
            break
          case '<<<':
            stdin = `${target}\n`
            break
          case '>':
          case '>>': {
            const path = resolveIn(state.cwd, target)
            // Truncation happens at redirect time, so `> file` empties it even
            // when the command writes nothing.
            if (redirection.subtype === '>') await this.fs.writeText(path, '')
            // Appends are ordered by the queue below: a sink is synchronous to
            // its caller, so writes are chained rather than raced.
            let pending: Promise<void> = Promise.resolve()
            const sink = (text: string): void => {
              pending = pending.then(async () => { await this.fs.writeText(path, text, true) })
              writes.push(pending)
            }
            if (redirection.fd === 2) err = sink
            else out = sink
            break
          }
          case '>&': {
            // Only descriptor duplication between stdout and stderr is
            // meaningful here: those are the only two the shell owns.
            if (redirection.fd === 2 && target === '1') err = out
            else if ((redirection.fd === null || redirection.fd === 1) && target === '2') out = err
            else {
              io.err(`bash: ${String(redirection.fd ?? 1)}>&${target}: unsupported descriptor redirection\n`)
              return 1
            }
            break
          }
          case '<&':
            io.err(`bash: <&${target}: unsupported descriptor redirection\n`)
            return 1
        }
      } catch (error) {
        io.err(`${describeFailure('bash', resolveIn(state.cwd, target), error)}\n`)
        return 1
      }
    }
    const status = await body({ stdin, out, err })
    await Promise.all(writes)
    return status
  }

  /** The expansion hook: `$( … )` runs on a nested interpreter of the same table. */
  private context(state: ShellState): ExpansionContext {
    return {
      state,
      fs: this.fs,
      substitute: async (shell: ShellLine): Promise<string> => {
        if (this.depth >= MAX_SUBSTITUTION_DEPTH) {
          throw new Error(`command substitution nested deeper than ${String(MAX_SUBSTITUTION_DEPTH)} levels`)
        }
        const captured = buffer()
        const nested = { ...state, environment: { ...state.environment }, variables: { ...state.variables } }
        const inner = new Interpreter(this.programs, this.fs, this.signal, this.depth + 1)
        await inner.line(shell, nested, { stdin: '', out: captured.write, err: () => {} })
        return captured.text().replace(/\n+$/, '')
      },
    }
  }

  /** Expand the right-hand side of one `NAME=value` assignment. */
  private async assignedValue(argument: ValueArgument | undefined, state: ShellState): Promise<string> {
    if (argument === undefined) return ''
    return (await expandArgument(argument, this.context(state))).join(' ')
  }
}

/**
 * Record one assignment. An exported name keeps its export (the environment
 * copy is what programs read); anything else stays a shell variable.
 */
function assign(state: ShellState, name: string, value: string): void {
  if (name in state.environment) state.environment[name] = value
  else state.variables[name] = value
}
