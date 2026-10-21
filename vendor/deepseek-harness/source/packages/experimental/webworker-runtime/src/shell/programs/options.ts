/**
 * Argument splitting shared by the command table: short flags (bundled or
 * separate), long flags, `--`, and the operands that follow.
 * @module @deepseek-ai/dsh-experimental-webworker-runtime/src/shell/programs/options
 */

/** One parsed argv: which flags were given, and what is left to act on. */
export interface ParsedOptions {
  /** Every short letter and long name seen, without their dashes. */
  readonly flags: ReadonlySet<string>
  /** Values of flags that take one (`-n 5` and `--name=x` both land here). */
  readonly values: ReadonlyMap<string, string>
  /** Everything that is not a flag, in order. */
  readonly operands: readonly string[]
}

/**
 * Split one program's arguments.
 *
 * A short letter listed in `valued` consumes the rest of its token (`-n5`) or
 * the next argument (`-n 5`); every other letter is a plain flag, so `-rn`
 * sets both `r` and `n`.
 * @param argv - the program's argv, including its name at index 0.
 * @param valued - short letters that take a value.
 * @returns the flags, their values, and the operands.
 */
export function parseOptions(argv: readonly string[], valued: ReadonlySet<string> = new Set()): ParsedOptions {
  const flags = new Set<string>()
  const values = new Map<string, string>()
  const operands: string[] = []
  const rest = argv.slice(1)
  let literal = false
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index] as string
    if (literal || argument === '-' || !argument.startsWith('-')) {
      operands.push(argument)
      continue
    }
    if (argument === '--') {
      literal = true
      continue
    }
    if (argument.startsWith('--')) {
      const [name, value] = splitLong(argument.slice(2))
      flags.add(name)
      if (value !== undefined) values.set(name, value)
      continue
    }
    for (let cursor = 1; cursor < argument.length; cursor += 1) {
      const letter = argument[cursor] as string
      flags.add(letter)
      if (!valued.has(letter)) continue
      const inline = argument.slice(cursor + 1)
      if (inline !== '') {
        values.set(letter, inline)
      } else {
        index += 1
        values.set(letter, rest[index] ?? '')
      }
      break
    }
  }
  return { flags, values, operands }
}

/** Split `name=value`; a long flag without `=` has no value. */
function splitLong(text: string): [string, string | undefined] {
  const separator = text.indexOf('=')
  return separator < 0 ? [text, undefined] : [text.slice(0, separator), text.slice(separator + 1)]
}

/**
 * Read a numeric flag value.
 * @param options - the parsed options.
 * @param flag - the short letter to read.
 * @param fallback - value to use when the flag is absent or unparsable.
 * @returns the number the caller should use.
 */
export function numberOption(options: ParsedOptions, flag: string, fallback: number): number {
  const raw = options.values.get(flag)
  if (raw === undefined) return fallback
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

/**
 * Split text into lines for the line-oriented utilities.
 * @param text - the text to split.
 * @returns its lines, without the trailing empty line a final newline creates.
 */
export function toLines(text: string): string[] {
  if (text === '') return []
  const lines = text.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}
