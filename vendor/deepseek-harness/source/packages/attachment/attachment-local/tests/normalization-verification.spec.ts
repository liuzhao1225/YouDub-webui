import sharp from 'sharp'
import { afterEach, describe, expect, it, vi } from 'vitest'

const control = vi.hoisted(() => ({ mismatch: false }))

vi.mock('../src/image.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/image.ts')>()
  return {
    ...actual,
    async detectImage(data: Uint8Array): Promise<Awaited<ReturnType<typeof actual.detectImage>>> {
      const detected = await actual.detectImage(data)
      return control.mismatch ? { ...detected, width: detected.width + 1 } : detected
    },
  }
})

import { normalizeImage } from '../src/normalization.ts'
import { detectImage } from '../src/image.ts'

afterEach(() => {
  control.mismatch = false
})

describe('normalization verification', () => {
  it('rejects a normalized output whose decoded facts disagree with the encoder result', async () => {
    const data = new Uint8Array(await sharp({
      create: { width: 10, height: 6, channels: 3, background: { r: 12, g: 200, b: 64 } },
    }).png().toBuffer())
    const detected = await detectImage(data)
    control.mismatch = true

    await expect(normalizeImage(data, detected, { maxPixels: 2048 * 2048, maxDimension: 5, maxBytes: 4 * 1024 * 1024 }))
      .rejects.toMatchObject({
        code: 'ATTACHMENT_WRITE_FAILED',
        message: 'Image normalization did not produce a single-frame 8-bit sRGB image with matching metadata.',
      })
  })
})
