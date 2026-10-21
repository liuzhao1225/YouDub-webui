/**
 * `node:url` for the worker: the two conversions the host tree uses, plus the
 * WHATWG classes the browser already provides. VFS paths are POSIX, so the
 * file-URL mapping is the simple percent-encoding pair.
 */

/**
 * Filesystem path of a `file:` URL.
 * @param url - file URL or its string form.
 * @returns the decoded POSIX path.
 */
export function fileURLToPath(url: string | URL): string {
  const parsed = typeof url === 'string' ? new URL(url) : url
  if (parsed.protocol !== 'file:') {
    throw new TypeError(`The URL must be of scheme file (received ${parsed.protocol})`)
  }
  return decodeURIComponent(parsed.pathname)
}

/**
 * `file:` URL of a filesystem path.
 * @param path - absolute or relative POSIX path.
 * @returns the URL.
 */
export function pathToFileURL(path: string): URL {
  // Only the characters the URL path parser would not escape itself are escaped
  // here (Node does the same), so `@`, `:` and `~` survive verbatim — scoped
  // package directories must round-trip unchanged.
  const escaped = path
    .replaceAll('%', '%25')
    .replaceAll('\\', '%5C')
    .replaceAll('\n', '%0A')
    .replaceAll('\r', '%0D')
    .replaceAll('\t', '%09')
  const url = new globalThis.URL('file:///')
  url.pathname = escaped.startsWith('/') ? escaped : `/${escaped}`
  return url
}

/**
 * Absolute URL from a specifier and its base.
 * @param specifier - relative or absolute specifier.
 * @param base - base URL.
 * @returns the resolved URL string.
 */
export function resolve(specifier: string, base: string): string {
  return new URL(specifier, base).toString()
}

/** WHATWG URL class, as `node:url` re-exports it. */
const UrlClass = globalThis.URL

/** WHATWG URLSearchParams class, as `node:url` re-exports it. */
const UrlSearchParamsClass = globalThis.URLSearchParams

export { UrlClass as URL, UrlSearchParamsClass as URLSearchParams }

/** CommonJS interop marker: the worker loader hands `default` to default imports (see ./builtins.ts). */
export const __esModule = true

/**
 * The `node:url` declarations this module stands in for. The two classes stay
 * the browser globals this worker runs on: the DOM and Node libraries declare
 * `URL.createObjectURL` and the `URLSearchParams` initializer union differently,
 * and re-declaring either would replace the objects the platform hands out.
 */
type NodeFace = Partial<Omit<typeof import('node:url'), 'URL' | 'URLSearchParams'>>
  & Record<'URL' | 'URLSearchParams', unknown>

/** CommonJS default export: the members `require()` hands a caller of this module. */
export default {
  fileURLToPath, pathToFileURL, resolve, URL: UrlClass, URLSearchParams: UrlSearchParamsClass,
} satisfies NodeFace
