/**
 * The image byte envelope. The packer writes one gzip member holding the ustar
 * archive, and the worker inflates it with the platform's own decompressor before
 * the tar reader sees a byte — `storage/tar.ts` stays a pure ustar reader with no
 * codec in it.
 *
 * Inflation runs on the fetch stream rather than on downloaded bytes: the
 * decompressor consumes each chunk as it lands, so unpacking overlaps the
 * download instead of following it, and the compressed copy never has to be held
 * whole in memory beside the archive it produces.
 *
 * One format, no negotiation: a body that does not start a gzip member is refused
 * by name, in the stream, before the decompressor sees it. Without that check a
 * plain tar, a truncated download, or a proxy's HTML error page would reach
 * `parseTar` and fail as a corrupt header field, which says nothing about what
 * the deployment actually served.
 * @module @deepseek-ai/dsh-experimental-webworker-runtime/src/storage/image-gzip
 */

/** gzip member identification bytes (RFC 1952 §2.3.1). */
const GZIP_MAGIC = [0x1f, 0x8b] as const

/** Bytes of a refused body quoted in the failure, enough to recognize text served in its place. */
const QUOTED_BYTES = 8

const hex = (bytes: Uint8Array): string =>
  [...bytes.slice(0, QUOTED_BYTES)].map(byte => byte.toString(16).padStart(2, '0')).join(' ')

/**
 * A pass-through that refuses a body which is not a gzip member.
 *
 * The check spans chunks: a transport may deliver the first byte alone, so the
 * head is held until it can be judged and then forwarded intact. A body that ends
 * before two bytes arrive is refused in `flush`, where "too short" is the only
 * thing left to report.
 * @param source - the image URL, or how the bytes arrived; named in a refusal.
 * @returns The transform to pipe the body through before the decompressor.
 */
function requireGzipMember(source: string): TransformStream<Uint8Array, Uint8Array> {
  let head: Uint8Array = new Uint8Array(0)
  let judged = false
  const refuse = (read: Uint8Array): Error => new Error(
    `webworker image: ${source} is not the gzip-compressed tar this deployment serves as its image `
    + `(expected a member starting 1f 8b, read ${read.byteLength === 0 ? 'an empty body' : hex(read)}); `
    + 'a host that answered with a Content-Encoding the transport already decoded, or a build that wrote '
    + 'the archive uncompressed, arrives exactly this way',
  )
  return new TransformStream<Uint8Array, Uint8Array>({
    transform: (chunk, controller): void => {
      if (judged) {
        controller.enqueue(chunk)
        return
      }
      const merged = new Uint8Array(head.byteLength + chunk.byteLength)
      merged.set(head)
      merged.set(chunk, head.byteLength)
      head = merged
      if (head.byteLength < GZIP_MAGIC.length) return
      if (GZIP_MAGIC.some((byte, at) => head[at] !== byte)) throw refuse(head)
      judged = true
      controller.enqueue(head)
    },
    flush: (): void => {
      if (!judged) throw refuse(head)
    },
  })
}

/**
 * Inflate a packed VFS image as it arrives.
 * @param body - the image body, straight from `fetch` or wrapped around bytes.
 * @param source - the image URL, or how the bytes arrived; named in a refusal.
 * @returns the ustar archive the image carries.
 * @throws When the body does not start a gzip member, or the member is corrupt.
 */
export async function inflateImageStream(body: ReadableStream<Uint8Array>, source: string): Promise<Uint8Array> {
  const inflated = body
    .pipeThrough(requireGzipMember(source))
    // The decompressor's writable half takes any BufferSource, which a
    // `ReadableStream<Uint8Array>` is not assignable to.
    .pipeThrough(new DecompressionStream('gzip') as unknown as TransformStream<Uint8Array, Uint8Array>)
  return new Uint8Array(await new Response(inflated).arrayBuffer())
}

/**
 * Inflate a packed VFS image held in memory.
 *
 * The bytes become a body so both entries run the same stream: one decompression
 * path, one refusal, whether the image came off the network or out of a caller's
 * buffer.
 * @param bytes - the image bytes.
 * @param source - how the bytes arrived; named in a refusal.
 * @returns the ustar archive the image carries.
 * @throws When the bytes do not start a gzip member, or the member is corrupt.
 */
export async function inflateImage(bytes: Uint8Array, source: string): Promise<Uint8Array> {
  const body = new Response(bytes as Uint8Array<ArrayBuffer>).body
  if (body === null) throw new Error(`webworker image: ${source} produced no readable body`)
  return await inflateImageStream(body, source)
}
