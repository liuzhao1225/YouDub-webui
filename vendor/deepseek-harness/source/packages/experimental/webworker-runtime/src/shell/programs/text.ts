/**
 * Text utilities of the command table. Each one reads its operands as files
 * and falls back to standard input, the way its POSIX counterpart does.
 * @module @deepseek-ai/dsh-experimental-webworker-runtime/src/shell/programs/text
 */

import { describeFailure, resolveIn } from '../fs-access.ts'
import type { ShellFileSystem, ShellIo, ShellProgram, ShellState } from '../types.ts'
import { numberOption, parseOptions, toLines } from './options.ts'

/**
 * Read every operand as a file, reporting the ones that fail.
 * @param program - name used in diagnostics.
 * @param operands - paths to read; empty means standard input.
 * @param io - source of standard input and sink for diagnostics.
 * @param state - shell state supplying the working directory.
 * @param fs - the filesystem to read from.
 * @returns one entry per readable source and the status the program should report.
 */
async function readInputs(
  program: string,
  operands: readonly string[],
  io: ShellIo,
  state: ShellState,
  fs: ShellFileSystem,
): Promise<{ sources: { name: string; text: string }[]; status: number }> {
  if (operands.length === 0) return { sources: [{ name: '-', text: io.stdin }], status: 0 }
  const sources: { name: string; text: string }[] = []
  let status = 0
  for (const operand of operands) {
    if (operand === '-') {
      sources.push({ name: '-', text: io.stdin })
      continue
    }
    const path = resolveIn(state.cwd, operand)
    try {
      sources.push({ name: operand, text: await fs.readText(path) })
    } catch (error) {
      io.err(`${describeFailure(program, operand, error)}\n`)
      status = 1
    }
  }
  return { sources, status }
}

/** Append a trailing newline unless the text already ends with one. */
function terminated(text: string): string {
  return text === '' || text.endsWith('\n') ? text : `${text}\n`
}

const echo: ShellProgram = (argv, io) => {
  const suppressNewline = argv[1] === '-n'
  const words = argv.slice(suppressNewline ? 2 : 1)
  io.out(`${words.join(' ')}${suppressNewline ? '' : '\n'}`)
  return 0
}

const printf: ShellProgram = (argv, io) => {
  const format = argv[1] ?? ''
  const operands = argv.slice(2)
  let cursor = 0
  // The conversions a shell script realistically uses; anything else is left
  // verbatim so the output shows what was not understood.
  const rendered = format.replace(/%[sdi%]/g, (match) => {
    if (match === '%%') return '%'
    const value = operands[cursor] ?? ''
    cursor += 1
    if (match === '%s') return value
    const parsed = Number.parseInt(value, 10)
    return String(Number.isFinite(parsed) ? parsed : 0)
  })
  io.out(rendered.replace(/\\n/g, '\n').replace(/\\t/g, '\t'))
  return 0
}

const cat: ShellProgram = async (argv, io, state, fs) => {
  const options = parseOptions(argv)
  const { sources, status } = await readInputs('cat', options.operands, io, state, fs)
  let line = 1
  for (const source of sources) {
    if (!options.flags.has('n')) {
      io.out(source.text)
      continue
    }
    for (const content of toLines(source.text)) {
      io.out(`${String(line).padStart(6)}\t${content}\n`)
      line += 1
    }
  }
  return status
}

const head: ShellProgram = async (argv, io, state, fs) => {
  const options = parseOptions(argv, new Set(['n']))
  const count = numberOption(options, 'n', 10)
  const { sources, status } = await readInputs('head', options.operands, io, state, fs)
  for (const [index, source] of sources.entries()) {
    if (sources.length > 1) io.out(`${index > 0 ? '\n' : ''}==> ${source.name} <==\n`)
    io.out(terminated(toLines(source.text).slice(0, count).join('\n')))
  }
  return status
}

const tail: ShellProgram = async (argv, io, state, fs) => {
  const options = parseOptions(argv, new Set(['n']))
  const count = numberOption(options, 'n', 10)
  const { sources, status } = await readInputs('tail', options.operands, io, state, fs)
  for (const [index, source] of sources.entries()) {
    if (sources.length > 1) io.out(`${index > 0 ? '\n' : ''}==> ${source.name} <==\n`)
    io.out(terminated(toLines(source.text).slice(-count).join('\n')))
  }
  return status
}

const wc: ShellProgram = async (argv, io, state, fs) => {
  const options = parseOptions(argv)
  const { sources, status } = await readInputs('wc', options.operands, io, state, fs)
  const selected = ['l', 'w', 'c'].filter(flag => options.flags.has(flag))
  const columns = selected.length > 0 ? selected : ['l', 'w', 'c']
  for (const source of sources) {
    const counts: Record<string, number> = {
      l: toLines(source.text).length,
      w: source.text.split(/\s+/).filter(word => word !== '').length,
      c: source.text.length,
    }
    const cells = columns.map(column => String(counts[column] ?? 0).padStart(columns.length > 1 ? 8 : 1))
    io.out(`${cells.join(' ')}${source.name === '-' ? '' : ` ${source.name}`}\n`)
  }
  return status
}

/** Collect every file under one directory, for `grep -r`. */
async function walkFiles(
  path: string,
  display: string,
  into: { path: string; display: string }[],
  fs: ShellFileSystem,
): Promise<void> {
  for (const entry of await fs.list(path)) {
    const child = `${path.endsWith('/') ? path : `${path}/`}${entry.name}`
    const shown = `${display.endsWith('/') ? display : `${display}/`}${entry.name}`
    if (entry.directory) await walkFiles(child, shown, into, fs)
    else into.push({ path: child, display: shown })
  }
}

const grep: ShellProgram = async (argv, io, state, fs) => {
  const options = parseOptions(argv, new Set(['e']))
  const pattern = options.values.get('e') ?? options.operands[0]
  const targets = options.values.get('e') === undefined ? options.operands.slice(1) : options.operands
  if (pattern === undefined) {
    io.err('grep: no pattern given\n')
    return 2
  }
  // Patterns are JavaScript regular expressions; `-F` matches them literally.
  const source = options.flags.has('F') ? pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : pattern
  let matcher: RegExp
  try {
    matcher = new RegExp(source, options.flags.has('i') ? 'i' : '')
  } catch (error) {
    io.err(`grep: invalid pattern: ${error instanceof Error ? error.message : String(error)}\n`)
    return 2
  }

  const sources: { name: string; text: string }[] = []
  let status = 0
  if (targets.length === 0) {
    sources.push({ name: '', text: io.stdin })
  } else {
    for (const target of targets) {
      const path = resolveIn(state.cwd, target)
      const stats = await fs.stat(path)
      if (stats?.directory === true) {
        if (!options.flags.has('r') && !options.flags.has('R')) {
          io.err(`grep: ${target}: Is a directory\n`)
          status = Math.max(status, 2)
          continue
        }
        const files: { path: string; display: string }[] = []
        await walkFiles(path, target, files, fs)
        for (const file of files) sources.push({ name: file.display, text: await fs.readText(file.path) })
        continue
      }
      try {
        sources.push({ name: target, text: await fs.readText(path) })
      } catch (error) {
        io.err(`${describeFailure('grep', target, error)}\n`)
        status = Math.max(status, 2)
      }
    }
  }

  const label = sources.length > 1 || options.flags.has('H')
  let matched = false
  for (const entry of sources) {
    const hits = toLines(entry.text)
      .map((text, index) => ({ text, number: index + 1 }))
      .filter(line => matcher.test(line.text) !== options.flags.has('v'))
    if (hits.length > 0) matched = true
    if (options.flags.has('l')) {
      if (hits.length > 0) io.out(`${entry.name}\n`)
      continue
    }
    if (options.flags.has('c')) {
      io.out(`${label && entry.name !== '' ? `${entry.name}:` : ''}${String(hits.length)}\n`)
      continue
    }
    for (const hit of hits) {
      const prefix = `${label && entry.name !== '' ? `${entry.name}:` : ''}${options.flags.has('n') ? `${String(hit.number)}:` : ''}`
      io.out(`${prefix}${hit.text}\n`)
    }
  }
  // `grep` reports "nothing matched" as status 1, distinct from an error.
  return status !== 0 ? status : matched ? 0 : 1
}

const sort: ShellProgram = async (argv, io, state, fs) => {
  const options = parseOptions(argv)
  const { sources, status } = await readInputs('sort', options.operands, io, state, fs)
  let lines = sources.flatMap(source => toLines(source.text))
  lines = options.flags.has('n')
    ? [...lines].sort((left, right) => (Number.parseFloat(left) || 0) - (Number.parseFloat(right) || 0))
    : [...lines].sort((left, right) => left < right ? -1 : left > right ? 1 : 0)
  if (options.flags.has('r')) lines.reverse()
  if (options.flags.has('u')) lines = [...new Set(lines)]
  io.out(terminated(lines.join('\n')))
  return status
}

const uniq: ShellProgram = async (argv, io, state, fs) => {
  const options = parseOptions(argv)
  const { sources, status } = await readInputs('uniq', options.operands, io, state, fs)
  const lines = sources.flatMap(source => toLines(source.text))
  const groups: { text: string; count: number }[] = []
  for (const line of lines) {
    const previous = groups[groups.length - 1]
    if (previous !== undefined && previous.text === line) previous.count += 1
    else groups.push({ text: line, count: 1 })
  }
  const selected = options.flags.has('d')
    ? groups.filter(group => group.count > 1)
    : options.flags.has('u') ? groups.filter(group => group.count === 1) : groups
  for (const group of selected) {
    io.out(`${options.flags.has('c') ? `${String(group.count).padStart(7)} ` : ''}${group.text}\n`)
  }
  return status
}

const cut: ShellProgram = async (argv, io, state, fs) => {
  const options = parseOptions(argv, new Set(['d', 'f', 'c']))
  const delimiter = options.values.get('d') ?? '\t'
  const fields = (options.values.get('f') ?? '').split(',').map(field => Number.parseInt(field, 10)).filter(Number.isFinite)
  const characters = options.values.get('c')
  const { sources, status } = await readInputs('cut', options.operands, io, state, fs)
  if (fields.length === 0 && characters === undefined) {
    io.err('cut: expected -f or -c\n')
    return 2
  }
  for (const source of sources) {
    for (const line of toLines(source.text)) {
      if (characters !== undefined) {
        const [from, to] = characters.split('-')
        const start = Number.parseInt(from ?? '1', 10) || 1
        const end = to === undefined || to === '' ? start : Number.parseInt(to, 10)
        io.out(`${line.slice(start - 1, end)}\n`)
        continue
      }
      const parts = line.split(delimiter)
      io.out(`${fields.map(field => parts[field - 1] ?? '').join(delimiter)}\n`)
    }
  }
  return status
}

/** Expand one `tr` set: `a-z` becomes every character in that range. */
function characterSet(set: string): string[] {
  // oxlint-disable-next-line typescript/no-misused-spread -- a `tr` set names characters, and code points are that unit.
  const characters = [...set]
  const expanded: string[] = []
  for (let index = 0; index < characters.length; index += 1) {
    const start = characters[index] as string
    const end = characters[index + 2]
    if (characters[index + 1] === '-' && end !== undefined) {
      for (let code = start.codePointAt(0) as number; code <= (end.codePointAt(0) as number); code += 1) {
        expanded.push(String.fromCodePoint(code))
      }
      index += 2
      continue
    }
    expanded.push(start)
  }
  return expanded
}

const tr: ShellProgram = (argv, io) => {
  const options = parseOptions(argv)
  const [fromSet, toSet] = options.operands
  const from = fromSet === undefined ? undefined : characterSet(fromSet).join('')
  const to = toSet === undefined ? undefined : characterSet(toSet).join('')
  if (from === undefined) {
    io.err('tr: expected a source set\n')
    return 2
  }
  if (options.flags.has('d')) {
    // oxlint-disable-next-line typescript/no-misused-spread -- `tr` deletes per character, and code points are the unit it deletes.
    io.out([...io.stdin].filter(character => !from.includes(character)).join(''))
    return 0
  }
  if (to === undefined) {
    io.err('tr: expected a replacement set\n')
    return 2
  }
  // oxlint-disable-next-line typescript/no-misused-spread -- `tr` translates per character, and code points are the unit it maps.
  io.out([...io.stdin].map((character) => {
    const index = from.indexOf(character)
    return index < 0 ? character : to[Math.min(index, to.length - 1)] as string
  }).join(''))
  return 0
}

/** `sed` accepts only the substitute command; anything else is reported, not guessed at. */
const sed: ShellProgram = async (argv, io, state, fs) => {
  const options = parseOptions(argv, new Set(['e']))
  const script = options.values.get('e') ?? options.operands[0]
  const targets = options.values.get('e') === undefined ? options.operands.slice(1) : options.operands
  const parsed = /^s(.)(.*?[^\\])?\1(.*?)\1([gi]*)$/.exec(script ?? '')
  if (parsed === null) {
    io.err('sed: only substitution scripts (s/pattern/replacement/) run in the worker host\n')
    return 2
  }
  const [, , pattern = '', replacement = '', modifiers = ''] = parsed
  let matcher: RegExp
  try {
    matcher = new RegExp(pattern, modifiers.includes('g') ? `g${modifiers.replace('g', '')}` : modifiers)
  } catch (error) {
    io.err(`sed: invalid pattern: ${error instanceof Error ? error.message : String(error)}\n`)
    return 2
  }
  const { sources, status } = await readInputs('sed', targets, io, state, fs)
  for (const source of sources) {
    for (const line of toLines(source.text)) io.out(`${line.replace(matcher, replacement.replace(/\\(\d)/g, '$$$1'))}\n`)
  }
  return status
}

const tee: ShellProgram = async (argv, io, state, fs) => {
  const options = parseOptions(argv)
  io.out(io.stdin)
  for (const operand of options.operands) {
    try {
      await fs.writeText(resolveIn(state.cwd, operand), io.stdin, options.flags.has('a'))
    } catch (error) {
      io.err(`${describeFailure('tee', operand, error)}\n`)
      return 1
    }
  }
  return 0
}

/** The text utilities, keyed by the name a command line uses. */
export const TEXT_PROGRAMS: Readonly<Record<string, ShellProgram>> = {
  echo, printf, cat, head, tail, wc, grep, sort, uniq, cut, tr, sed, tee,
}
