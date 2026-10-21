/**
 * The image byte envelope: the worker inflates one gzip member off the response
 * stream and refuses anything else by name.
 *
 * The refusal is the load-bearing case. A deployment that serves a plain tar, a
 * truncated download, or a proxy's HTML error page under the image URL would
 * otherwise reach the tar reader, which reports a corrupt header field and says
 * nothing about what arrived — so the check has to name the source and the format
 * it expected. It also has to survive chunking: the two identification bytes may
 * arrive one at a time, which the single-byte case below feeds deliberately.
 */
import { gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { inflateImage, inflateImageStream } from '../../src/storage/image-gzip.ts'
import { loadVfsImage } from '../../src/storage/memory.ts'
import { packTar } from '../../src/storage/tar.ts'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** A two-entry archive, as the packer would lay one out under the virtual root. */
const archive = (): Uint8Array => packTar({
  'config/cordis.yml': encoder.encode('- id: subject\n'),
  'node_modules/@scope/pkg/lib/index.js': encoder.encode('exports.answer = 42\n'),
})

/** The bytes as a body delivered `size` bytes at a time, the way a transport may. */
const chunked = (bytes: Uint8Array, size: number): ReadableStream<Uint8Array> => {
  let at = 0
  return new ReadableStream<Uint8Array>({
    pull: (controller): void => {
      if (at >= bytes.byteLength) {
        controller.close()
        return
      }
      controller.enqueue(bytes.slice(at, at + size))
      at += size
    },
  })
}

describe('image gzip envelope', () => {
  it('inflates a compressed image into the archive the packer wrote', async () => {
    const tar = archive()
    const inflated = await inflateImage(gzipSync(tar), 'the spec image')
    expect(inflated.byteLength).toBe(tar.byteLength)
    expect([...inflated]).toEqual([...tar])
  })

  it('inflates a body delivered one byte at a time', async () => {
    const tar = archive()
    const inflated = await inflateImageStream(chunked(gzipSync(tar), 1), 'the spec image')
    expect([...inflated]).toEqual([...tar])
  })

  it('mounts an inflated image through the real VFS loader', async () => {
    const vfs = loadVfsImage(await inflateImage(gzipSync(archive()), 'the spec image'), '/dsh')
    expect(vfs.existsSync('/dsh/node_modules/@scope/pkg/lib/index.js')).toBe(true)
    expect(decoder.decode(vfs.readFileSync('/dsh/config/cordis.yml') as Uint8Array)).toBe('- id: subject\n')
  })

  it('refuses an uncompressed tar, naming the source and the expected member', async () => {
    await expect(inflateImage(archive(), 'https://example.test/vfs-image.tar.gz')).rejects.toThrow(
      /https:\/\/example\.test\/vfs-image\.tar\.gz is not the gzip-compressed tar .*expected a member starting 1f 8b, read/,
    )
  })

  it('refuses a page served in the image\'s place, quoting what it read', async () => {
    const page = encoder.encode('<!doctype html><title>404</title>')
    await expect(inflateImage(page, 'the image bytes')).rejects.toThrow(/read 3c 21 64 6f 63 74 79 70/)
  })

  it('refuses a body that ends before the header, one byte at a time', async () => {
    await expect(inflateImageStream(chunked(new Uint8Array([0x1f]), 1), 'the spec image'))
      .rejects.toThrow(/expected a member starting 1f 8b, read 1f/)
  })

  it('refuses an empty body as such', async () => {
    await expect(inflateImage(new Uint8Array(0), 'the spec image')).rejects.toThrow(/read an empty body/)
  })

  it('refuses a truncated gzip member instead of mounting a partial archive', async () => {
    const compressed = gzipSync(archive())
    await expect(inflateImage(compressed.subarray(0, compressed.byteLength - 64), 'the spec image')).rejects.toThrow()
  })
})
