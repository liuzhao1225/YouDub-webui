import { describe, expect, it } from 'vitest'
import { clampWidth } from '../src/client/columns.ts'

describe('clampWidth', () => {
  it('clamps into the range and rounds', () => {
    expect(clampWidth(280.4)).toBe(280)
    expect(clampWidth(100)).toBe(264)
    expect(clampWidth(9999)).toBe(420)
  })
})
