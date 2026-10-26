import { describe, expect, it } from 'vitest'
import { clampWidth, computeColumns } from '../src/client/columns.ts'

describe('clampWidth', () => {
  it('clamps into the range and rounds', () => {
    expect(clampWidth(250.4, 240, 420)).toBe(250)
    expect(clampWidth(100, 240, 420)).toBe(240)
    expect(clampWidth(9999, 240, 420)).toBe(420)
  })
})

describe('computeColumns', () => {
  it('reserves the sidebar preference and gives the content the remainder', () => {
    expect(computeColumns(1920, 280)).toEqual({ sidebar: 280, center: 1640 })
  })

  it('keeps a web icon rail or fully hides the collapsed desktop sidebar', () => {
    expect(computeColumns(1920, 0)).toEqual({ sidebar: 56, center: 1864 })
    expect(computeColumns(1920, 0, 0)).toEqual({ sidebar: 0, center: 1920 })
  })

  it('clamps sidebar preferences and never returns a negative content width', () => {
    expect(computeColumns(3000, 9999)).toEqual({ sidebar: 420, center: 2580 })
    expect(computeColumns(1920, 1)).toEqual({ sidebar: 264, center: 1656 })
    expect(computeColumns(20, 0)).toEqual({ sidebar: 56, center: 0 })
  })
})
