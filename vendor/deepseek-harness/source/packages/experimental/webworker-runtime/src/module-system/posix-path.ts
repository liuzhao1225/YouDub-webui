/**
 * POSIX path helpers for the worker VFS: one absolute root, no drive letters,
 * no symlinks.
 *
 * **Not a `node:path` substitute.** {@link dirname}, {@link basename}, and
 * {@link parse} normalize first, because every caller here hands the result to
 * the VFS, which keys files by normalized absolute path — `dirname('/a/b/..')`
 * answers `/`, the directory that actually holds the entry. Node's three are
 * purely lexical and answer `/a/b`. A `node:path` proxy owes callers Node's
 * literal answers, so it needs its own port of Node's implementation rather than
 * a facade over this module; measured over ~200 cases, the normalizing and
 * lexical forms diverge in 45, all in these three functions. The Node-facing
 * port is pinned separately by `../../tests/node/path-diff.spec.ts`.
 * @module @deepseek-ai/dsh-experimental-webworker-runtime/src/module-system/posix-path
 */

/** Path separator of the virtual filesystem. */
export const SEP = '/'

/**
 * Collapse `.` and `..` segments.
 * @param path - Path with any number of separators.
 * @returns Normalized path; a relative input keeps leading `..` segments.
 */
export function normalize(path: string): string {
  const absolute = path.startsWith(SEP)
  const trailing = path.length > 1 && path.endsWith(SEP)
  const out: string[] = []
  for (const segment of path.split(SEP)) {
    if (segment === '' || segment === '.') continue
    if (segment === '..' && out.length > 0 && out[out.length - 1] !== '..') {
      out.pop()
      continue
    }
    if (segment === '..' && absolute) continue
    out.push(segment)
  }
  const body = out.join(SEP)
  if (absolute) return SEP + body + (trailing && body !== '' ? SEP : '')
  if (body === '') return trailing ? './' : '.'
  return body + (trailing ? SEP : '')
}

/**
 * Join segments and normalize the result.
 * @param segments - Path segments.
 * @returns Joined path, `.` when nothing remains.
 */
export function join(...segments: string[]): string {
  const joined = segments.filter(segment => segment !== '').join(SEP)
  return joined === '' ? '.' : normalize(joined)
}

/**
 * Resolve segments right to left against a base directory.
 * @param segments - Path segments; the first absolute one wins.
 * @returns Absolute normalized path.
 */
export function resolve(...segments: string[]): string {
  let path = ''
  for (const segment of [...segments].reverse()) {
    if (segment === '') continue
    path = path === '' ? segment : `${segment}${SEP}${path}`
    if (segment.startsWith(SEP)) break
  }
  return normalize(path.startsWith(SEP) ? path : `${SEP}${path}`)
}

/**
 * Directory part of a path, after normalization (see the module note).
 * @param path - Path to inspect.
 * @returns Parent path; `/` for root children and `.` for bare names.
 */
export function dirname(path: string): string {
  const normalized = normalize(path).replace(/\/+$/, '')
  const index = normalized.lastIndexOf(SEP)
  if (index < 0) return '.'
  if (index === 0) return SEP
  return normalized.slice(0, index)
}

/**
 * Last segment of a path, after normalization (see the module note).
 * @param path - Path to inspect.
 * @param suffix - Optional suffix to strip.
 * @returns Final segment.
 */
export function basename(path: string, suffix?: string): string {
  const normalized = normalize(path).replace(/\/+$/, '')
  const name = normalized.slice(normalized.lastIndexOf(SEP) + 1)
  if (suffix !== undefined && suffix !== name && name.endsWith(suffix)) return name.slice(0, -suffix.length)
  return name
}

/**
 * Extension of the last segment, dot included.
 * @param path - Path to inspect.
 * @returns Extension, or an empty string when there is none.
 */
export function extname(path: string): string {
  const name = basename(path)
  const index = name.lastIndexOf('.')
  return index <= 0 ? '' : name.slice(index)
}

/**
 * Report whether a path starts at the root.
 * @param path - Path to inspect.
 * @returns True for absolute paths.
 */
export function isAbsolute(path: string): boolean {
  return path.startsWith(SEP)
}

/**
 * Relative path from one absolute path to another.
 * @param from - Source directory.
 * @param to - Target path.
 * @returns Relative path using `..` segments.
 */
export function relative(from: string, to: string): string {
  const source = resolve(from).split(SEP).filter(segment => segment !== '')
  const target = resolve(to).split(SEP).filter(segment => segment !== '')
  let shared = 0
  while (shared < source.length && shared < target.length && source[shared] === target[shared]) shared += 1
  const up = new Array(source.length - shared).fill('..') as string[]
  return [...up, ...target.slice(shared)].join(SEP)
}

/**
 * Split a path into components, after normalization (see the module note).
 * @param path - Path to split.
 * @returns Root, directory, base name, extension, and stem.
 */
export function parse(path: string): { root: string; dir: string; base: string; ext: string; name: string } {
  const root = isAbsolute(path) ? SEP : ''
  const base = basename(path)
  const ext = extname(path)
  return { root, dir: dirname(path), base, ext, name: ext === '' ? base : base.slice(0, -ext.length) }
}

/**
 * Node's Windows-only namespaced-path conversion.
 * @param path - the path to convert.
 * @returns The path unchanged; namespaced paths are a Windows concept.
 */
export function toNamespacedPath(path: string): string {
  return path
}

/**
 * Convert a VFS path into a `file:` URL string.
 * @param path - Absolute VFS path.
 * @returns URL text with each segment percent-encoded.
 */
export function pathToFileUrl(path: string): string {
  const absolute = resolve(path)
  return `file://${absolute.split(SEP).map(segment => encodeURIComponent(segment)).join(SEP)}`
}

/**
 * Convert a `file:` URL back into a VFS path.
 * @param url - URL text or URL instance.
 * @returns Absolute VFS path.
 */
export function fileUrlToPath(url: string | URL): string {
  const text = typeof url === 'string' ? url : url.href
  if (!text.startsWith('file://')) throw new Error(`webworker vfs: not a file URL: ${text}`)
  return decodeURIComponent(text.slice('file://'.length).replace(/[?#].*$/, '')) || SEP
}
