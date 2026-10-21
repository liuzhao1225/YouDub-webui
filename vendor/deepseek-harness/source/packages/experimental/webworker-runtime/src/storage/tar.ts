/**
 * Uncompressed ustar archive: the VFS image format. One fetch delivers the
 * whole tree, and the reader hands out subarray views into the fetched buffer,
 * so mounting copies nothing and no inflate step runs inside the worker.
 *
 * Hand-rolled on purpose: both sides need synchronous in-memory operation and
 * the reader ships inside the worker bundle, where the streaming tar packages
 * would drag Node stream shims back in. The subset is plain ustar — regular
 * files and directories, names up to 255 bytes via the name-prefix split — and
 * anything outside it fails loud on either side.
 * @module @deepseek-ai/dsh-experimental-webworker-runtime/src/storage/tar
 */

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const BLOCK = 512

/** One archive entry; a directory carries empty bytes and a trailing-slash name. */
export interface TarEntry {
  readonly name: string
  readonly bytes: Uint8Array
  readonly directory: boolean
  /** Permission bits from the header's mode field (`0o777` mask). */
  readonly mode: number
}

/** Write an octal field: zero-padded digits with a terminating NUL. */
function writeOctal(header: Uint8Array, offset: number, length: number, value: number): void {
  header.set(encoder.encode(value.toString(8).padStart(length - 1, '0')), offset)
}

/**
 * Split an entry name into the ustar name and prefix fields.
 * @param name - Full entry name.
 * @returns The two fields; the prefix is empty when the name fits directly.
 * @throws When no slash yields name ≤ 100 and prefix ≤ 155 bytes: the entry
 * cannot be archived and a silently truncated name would corrupt the image.
 */
function splitName(name: string): { name: string; prefix: string } {
  if (encoder.encode(name).length <= 100) return { name, prefix: '' }
  for (let index = name.length - 1; index > 0; index -= 1) {
    if (name[index] !== '/') continue
    const prefix = name.slice(0, index)
    const rest = name.slice(index + 1)
    if (encoder.encode(rest).length <= 100 && encoder.encode(prefix).length <= 155) {
      return { name: rest, prefix }
    }
  }
  throw new Error(`vfs tar: entry name does not fit the ustar name+prefix split: ${name}`)
}

/**
 * Pack entries into one uncompressed ustar archive.
 *
 * Entries keep their given order; names ending in a slash become directory
 * entries. Contents are written verbatim — compression belongs to the HTTP
 * transport, not to the archive.
 * @param files - Entry name to content bytes.
 * @returns The archive bytes.
 */
export function packTar(files: Readonly<Record<string, Uint8Array>>): Uint8Array {
  const chunks: Uint8Array[] = []
  for (const [entryName, bytes] of Object.entries(files)) {
    const directory = entryName.endsWith('/')
    const size = directory ? 0 : bytes.length
    const { name, prefix } = splitName(entryName)
    const header = new Uint8Array(BLOCK)
    header.set(encoder.encode(name), 0)
    writeOctal(header, 100, 8, directory ? 0o755 : 0o644)
    writeOctal(header, 108, 8, 0)
    writeOctal(header, 116, 8, 0)
    writeOctal(header, 124, 12, size)
    writeOctal(header, 136, 12, 0)
    header.fill(0x20, 148, 156)
    header[156] = directory ? 0x35 : 0x30
    header.set(encoder.encode('ustar'), 257)
    header.set(encoder.encode('00'), 263)
    header.set(encoder.encode(prefix), 345)
    let checksum = 0
    for (const byte of header) checksum += byte
    header.set(encoder.encode(checksum.toString(8).padStart(6, '0')), 148)
    header[154] = 0
    header[155] = 0x20
    chunks.push(header)
    if (size > 0) {
      chunks.push(bytes)
      const padding = size % BLOCK
      if (padding !== 0) chunks.push(new Uint8Array(BLOCK - padding))
    }
  }
  chunks.push(new Uint8Array(BLOCK * 2))
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const archive = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    archive.set(chunk, offset)
    offset += chunk.length
  }
  return archive
}

/** @returns The NUL-terminated string in one header field. */
function readField(header: Uint8Array, offset: number, length: number): string {
  let end = offset
  while (end < offset + length && header[end] !== 0) end += 1
  return decoder.decode(header.subarray(offset, end))
}

/**
 * Parse an uncompressed ustar archive.
 *
 * File bytes are subarray views into `archive`, not copies; callers own the
 * aliasing. Entry kinds outside the written subset (links, PAX extensions)
 * fail loud instead of being skipped.
 * @param archive - Archive bytes.
 * @returns Entries in archive order.
 */
export function parseTar(archive: Uint8Array): TarEntry[] {
  const entries: TarEntry[] = []
  let offset = 0
  while (offset + BLOCK <= archive.length) {
    const header = archive.subarray(offset, offset + BLOCK)
    if (header.every(byte => byte === 0)) break
    const short = readField(header, 0, 100)
    const prefix = readField(header, 345, 155)
    const name = prefix === '' ? short : `${prefix}/${short}`
    const size = Number.parseInt(readField(header, 124, 12).trim() || '0', 8)
    const mode = Number.parseInt(readField(header, 100, 8).trim() || '0', 8) & 0o777
    const typeflag = header[156]
    const directory = typeflag === 0x35 || name.endsWith('/')
    if (typeflag !== 0x30 && typeflag !== 0 && typeflag !== 0x35) {
      throw new Error(`vfs tar: unsupported entry type ${String.fromCharCode(typeflag ?? 0)} for "${name}"`)
    }
    const dataStart = offset + BLOCK
    entries.push({ name, bytes: archive.subarray(dataStart, dataStart + size), directory, mode })
    offset = dataStart + Math.ceil(size / BLOCK) * BLOCK
  }
  return entries
}
