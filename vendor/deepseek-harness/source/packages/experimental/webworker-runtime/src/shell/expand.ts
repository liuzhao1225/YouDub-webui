/**
 * Word expansion: one parsed argument becomes the zero or more fields a
 * program receives in its argv. Covers the segment kinds the grammar produces
 * — literal text, variables (with `:-` / `:+` forms), command substitution,
 * arithmetic, and globs matched against the VFS.
 * @module @deepseek-ai/dsh-experimental-webworker-runtime/src/shell/expand
 */

import picomatch from 'picomatch'
import type { ArgumentSegment, ArithmeticExpression, ShellLine, ValueArgument } from './ast.ts'
import { resolve } from '../module-system/posix-path.ts'
import type { ShellFileSystem, ShellState } from './types.ts'

/** Characters that make the grammar treat a whole word as a glob pattern. */
const GLOB_PATTERN = /[*?]|\[[^\]]*\]/

/**
 * Whether one word is a glob the shell should match against the filesystem.
 * Handed to `parseShell`, which decides between a `text` and a `glob` segment.
 * @param word - the word exactly as it was written.
 * @returns true when the word contains a wildcard.
 */
export function isGlobPattern(word: string): boolean {
  return GLOB_PATTERN.test(word)
}

/**
 * Read one variable the way `$name` does.
 *
 * Shell variables shadow the environment (an assignment without `export` is
 * only visible to this shell), and the specials report what a shell without
 * job control or positional parameters can honestly report.
 * @param state - the shell state to read.
 * @param name - variable name, or one of `?`, `$`, `#`, `@`, `*`, `0`.
 * @returns the value, or undefined when the variable is unset.
 */
export function readVariable(state: ShellState, name: string): string | undefined {
  switch (name) {
    case '?': return String(state.lastStatus)
    // The worker host runs the whole tree as pid 1; `$$` reports it verbatim.
    case '$': return '1'
    case '0': return 'bash'
    // No positional parameters reach a `bash -c` command line here.
    case '#': return '0'
    case '@': case '*': return ''
    default: return state.variables[name] ?? state.environment[name]
  }
}

/** Evaluate `$(( … ))`. */
function arithmetic(expression: ArithmeticExpression, state: ShellState): number {
  switch (expression.type) {
    case 'number': return expression.value
    case 'variable': return Number.parseInt(readVariable(state, expression.name) ?? '0', 10) || 0
    case 'addition': return arithmetic(expression.left, state) + arithmetic(expression.right, state)
    case 'subtraction': return arithmetic(expression.left, state) - arithmetic(expression.right, state)
    case 'multiplication': return arithmetic(expression.left, state) * arithmetic(expression.right, state)
    case 'division': return Math.trunc(arithmetic(expression.left, state) / arithmetic(expression.right, state))
  }
}

/**
 * Expand one glob against the filesystem, one path segment at a time.
 *
 * Matches keep the pattern's own spelling: a relative pattern yields relative
 * paths, so `ls *.ts` prints what the model typed.
 * @param pattern - the glob as written.
 * @param cwd - directory a relative pattern starts from.
 * @param fs - the filesystem to match against.
 * @returns sorted matches, or an empty array when nothing matches.
 */
export async function expandGlob(pattern: string, cwd: string, fs: ShellFileSystem): Promise<string[]> {
  const absolute = pattern.startsWith('/')
  const segments = pattern.split('/').filter(segment => segment !== '')
  // A glob walks paths that may not exist or may not be directories; both
  // simply contribute no matches, so listing failures are absorbed here.
  const safeList = async (path: string): Promise<{ name: string; directory: boolean }[]> => {
    try {
      return await fs.list(path)
    } catch {
      return []
    }
  }
  // Each frontier entry pairs the directory to search with the prefix that
  // reproduces the caller's spelling for anything found under it.
  let frontier: { path: string; display: string }[] = [{ path: absolute ? '/' : cwd, display: absolute ? '/' : '' }]
  for (const [index, segment] of segments.entries()) {
    const last = index === segments.length - 1
    const next: { path: string; display: string }[] = []
    for (const entry of frontier) {
      if (segment === '**') {
        // `**` stands for this directory and every directory below it.
        const stack = [entry]
        while (stack.length > 0) {
          const current = stack.pop() as { path: string; display: string }
          next.push(current)
          for (const child of await safeList(current.path)) {
            if (child.directory) {
              stack.push({ path: resolve(current.path, child.name), display: `${current.display}${child.name}/` })
            }
          }
        }
        continue
      }
      if (!isGlobPattern(segment)) {
        const path = resolve(entry.path, segment)
        if (await fs.stat(path) === undefined) continue
        next.push({ path, display: `${entry.display}${segment}${last ? '' : '/'}` })
        continue
      }
      const matches = picomatch(segment, { dot: segment.startsWith('.') })
      for (const child of await safeList(entry.path)) {
        if (!matches(child.name)) continue
        if (!last && !child.directory) continue
        next.push({ path: resolve(entry.path, child.name), display: `${entry.display}${child.name}${last ? '' : '/'}` })
      }
    }
    frontier = next
  }
  // A `**` frontier carries trailing separators from its own expansion; the
  // shell reports directory matches without one.
  return [...new Set(frontier.map(entry => entry.display.replace(/\/$/, '')))].filter(match => match !== '').sort()
}

/**
 * Everything expansion needs that the argument itself cannot supply: how to
 * run a command substitution, and the state variables resolve against.
 */
export interface ExpansionContext {
  state: ShellState
  /** The filesystem globs match against. */
  fs: ShellFileSystem
  /**
   * Run one nested command line and return its standard output.
   * @param shell - the parsed line inside `$( … )`.
   * @returns the captured output, with trailing newlines already stripped.
   */
  substitute(shell: ShellLine): Promise<string>
}

/**
 * Expand one argument into fields.
 *
 * Unquoted expansions split on whitespace the way a shell does, so
 * `cat $FILES` with two names runs `cat` with two arguments while
 * `cat "$FILES"` runs it with one.
 * @param argument - the parsed argument.
 * @param context - substitution hook and shell state.
 * @returns the fields this argument contributes to argv.
 */
export async function expandArgument(argument: ValueArgument, context: ExpansionContext): Promise<string[]> {
  const fields: string[] = []
  // `undefined` means "no field started yet": an unset unquoted variable must
  // contribute nothing rather than an empty argument.
  let current: string | undefined

  const append = (text: string): void => { current = (current ?? '') + text }
  const appendSplit = (text: string): void => {
    const parts = text.split(/\s+/)
    for (const [index, part] of parts.entries()) {
      if (index > 0) {
        if (current !== undefined) fields.push(current)
        current = undefined
      }
      if (part !== '') append(part)
    }
  }

  for (const segment of argument.segments) {
    switch (segment.type) {
      case 'text':
        append(segment.text)
        break
      case 'arithmetic':
        append(String(arithmetic(segment.arithmetic, context.state)))
        break
      case 'variable': {
        const value = await expandVariable(segment, context)
        if (segment.quoted) append(value)
        else appendSplit(value)
        break
      }
      case 'shell': {
        const output = await context.substitute(segment.shell)
        if (segment.quoted) append(output)
        else appendSplit(output)
        break
      }
      case 'glob': {
        const matches = await expandGlob(segment.pattern, context.state.cwd, context.fs)
        if (matches.length === 0) {
          // No match: a POSIX shell passes the pattern through unchanged.
          append(segment.pattern)
          break
        }
        for (const [index, match] of matches.entries()) {
          if (index > 0) {
            fields.push(current as string)
            current = undefined
          }
          append(match)
        }
        break
      }
    }
  }
  if (current !== undefined) fields.push(current)
  return fields
}

/** Resolve one `${name}` segment, including its `:-` and `:+` alternatives. */
async function expandVariable(
  segment: Extract<ArgumentSegment, { type: 'variable' }>,
  context: ExpansionContext,
): Promise<string> {
  const value = readVariable(context.state, segment.name)
  const set = value !== undefined && value !== ''
  if (!set && segment.defaultValue !== undefined) return await joinArguments(segment.defaultValue, context)
  if (set && segment.alternativeValue !== undefined) return await joinArguments(segment.alternativeValue, context)
  return value ?? ''
}

/** Expand a `:-` / `:+` operand, which is itself a list of arguments. */
async function joinArguments(operand: ValueArgument[], context: ExpansionContext): Promise<string> {
  const parts: string[] = []
  for (const argument of operand) parts.push(...await expandArgument(argument, context))
  return parts.join(' ')
}
