/**
 * `node:zlib` for the worker. The worker composition carries no compression
 * codec: the boot patch forces the JSONL session backend onto its plaintext
 * path (`compression: 'none'`), because the VFS is in-memory and compressing
 * it buys nothing. The Zstandard surface keeps its module-scope shape — the
 * backend reads `constants` and `promisify`s the callback forms while
 * loading — and every codec call fails loud, naming the missing capability.
 *
 * `createZstdDecompress` returns a handle-less object on purpose: the backend
 * probes for Node's private stream shape and falls back to its public one-shot
 * decoder when the probe declines.
 */
import { notImplementedFail } from '../../notImplementedFail.ts'

const MODULE = 'node:zlib'

/** Zstandard parameter/flush constants read at module scope by the JSONL backend. */
export const constants = {
  ZSTD_c_compressionLevel: 100,
  ZSTD_c_checksumFlag: 201,
  ZSTD_e_continue: 0,
  ZSTD_e_flush: 1,
  ZSTD_e_end: 2,
  ZSTD_CLEVEL_DEFAULT: 3,
  Z_NO_FLUSH: 0,
  Z_SYNC_FLUSH: 2,
  Z_FINISH: 4,
}

/** One-shot Zstandard compression (unavailable; the composition writes plaintext logs). */
export const zstdCompressSync: typeof import('node:zlib').zstdCompressSync = notImplementedFail(MODULE, 'zstdCompressSync')

/** One-shot Zstandard decompression (unavailable; the worker never reads compressed logs). */
export const zstdDecompressSync: typeof import('node:zlib').zstdDecompressSync
  = notImplementedFail(MODULE, 'zstdDecompressSync')

/** Callback form of {@link zstdCompressSync} (`promisify`'d at module scope by the backend). */
export const zstdCompress: typeof import('node:zlib').zstdCompress = notImplementedFail(MODULE, 'zstdCompress')

/** Callback form of {@link zstdDecompressSync}. */
export const zstdDecompress: typeof import('node:zlib').zstdDecompress = notImplementedFail(MODULE, 'zstdDecompress')

/**
 * Streaming Zstandard decoder placeholder: the returned object deliberately
 * lacks Node's private `_handle`/`_writeState` members, which is the signal the
 * backend's private-shape probe checks before choosing that path.
 * @returns the incompatible placeholder stream.
 */
export function createZstdDecompress(): Record<string, unknown> {
  return { close: () => { /* nothing was opened */ } }
}

/** Streaming Zstandard encoder (unavailable; the backend only needs one-shot). */
export const createZstdCompress: typeof import('node:zlib').createZstdCompress
  = notImplementedFail(MODULE, 'createZstdCompress')

/** gzip family (unavailable; no consumer in the reachable tree). */
export const gzip: typeof import('node:zlib').gzip = notImplementedFail(MODULE, 'gzip')

/** gzip sync counterpart. */
export const gzipSync: typeof import('node:zlib').gzipSync = notImplementedFail(MODULE, 'gzipSync')

/** gunzip counterpart. */
export const gunzip: typeof import('node:zlib').gunzip = notImplementedFail(MODULE, 'gunzip')

/** gunzip sync counterpart. */
export const gunzipSync: typeof import('node:zlib').gunzipSync = notImplementedFail(MODULE, 'gunzipSync')

/** CommonJS interop marker: the worker loader hands `default` to default imports (see ./builtins.ts). */
export const __esModule = true

/**
 * The `node:zlib` declarations this module stands in for. Two members keep this
 * module's own types: `constants` carries only the Zstandard and flush values the
 * JSONL backend reads, and `createZstdDecompress` answers the placeholder the
 * same backend's private-shape probe must decline.
 */
type NodeFace = Partial<Omit<typeof import('node:zlib'), 'constants' | 'createZstdDecompress'>>
  & Record<'constants' | 'createZstdDecompress', unknown>

/** CommonJS default export: the members `require()` hands a caller of this module. */
export default {
  constants, zstdCompress, zstdCompressSync, zstdDecompress, zstdDecompressSync,
  createZstdCompress, createZstdDecompress, gzip, gzipSync, gunzip, gunzipSync,
} satisfies NodeFace
