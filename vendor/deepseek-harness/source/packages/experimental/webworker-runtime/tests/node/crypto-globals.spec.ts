/**
 * The crypto global patch and the shim UUID it installs: on an insecure
 * origin the platform withholds `crypto.randomUUID` while product code calls
 * it off the global, so the worker fills the one missing method — and leaves
 * a platform that already has it untouched.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installCryptoGlobals } from '../../src/node/globals/crypto.ts'
import { randomUUID } from '../../src/node/builtin_modules/implemented/crypto.ts'

const V4_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('the shim randomUUID', () => {
  it('emits RFC 9562 v4 ids without touching the platform method', () => {
    for (let round = 0; round < 32; round += 1) expect(randomUUID()).toMatch(V4_SHAPE)
    expect(new Set(Array.from({ length: 32 }, () => randomUUID())).size).toBe(32)
  })
})

describe('installCryptoGlobals', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('fills randomUUID on a crypto that lacks it, the insecure-origin shape', () => {
    const bare = { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) }
    vi.stubGlobal('crypto', bare)
    installCryptoGlobals()
    expect(globalThis.crypto.randomUUID()).toMatch(V4_SHAPE)
  })

  it('leaves a platform that already provides randomUUID untouched', () => {
    const platform = (): string => 'platform-owned'
    vi.stubGlobal('crypto', { randomUUID: platform })
    installCryptoGlobals()
    expect(Reflect.get(globalThis.crypto, 'randomUUID')).toBe(platform)
  })
})
