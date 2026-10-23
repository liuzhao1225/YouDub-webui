/**
 * The minted UUID's contract: RFC 9562 v4 shape (version and variant bits
 * pinned), uniqueness across calls, and no dependence on the secure-context
 * `crypto.randomUUID` — the reason this package exists.
 */
import { describe, expect, it, vi } from 'vitest'
import { bytesToBase64, randomUUID } from '../src/index.ts'

const V4_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('randomUUID', () => {
  it('emits RFC 9562 v4 ids', () => {
    for (let round = 0; round < 64; round += 1) expect(randomUUID()).toMatch(V4_SHAPE)
  })

  it('emits distinct ids across calls', () => {
    expect(new Set(Array.from({ length: 64 }, () => randomUUID())).size).toBe(64)
  })

  it('mints without the platform randomUUID, the insecure-origin shape', () => {
    const bare = { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) }
    vi.stubGlobal('crypto', bare)
    try {
      expect(randomUUID()).toMatch(V4_SHAPE)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('bytesToBase64', () => {
  it('encodes empty, binary, and multi-chunk byte arrays', () => {
    expect(bytesToBase64(new Uint8Array())).toBe('')
    expect(bytesToBase64(new Uint8Array([0, 127, 128, 255]))).toBe('AH+A/w==')
    expect(bytesToBase64(new Uint8Array(0x8001).fill(65))).toBe('QUFB'.repeat(10923))
  })
})
