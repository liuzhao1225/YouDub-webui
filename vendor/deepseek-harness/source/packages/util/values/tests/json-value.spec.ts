import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { isJsonValue } from '../src/index.ts'

describe('JSON value boundary', () => {
  it('accepts plain, null-prototype and foreign-realm JSON without limiting nesting', () => {
    expect(isJsonValue({ text: 'hello', list: [1, true, null] })).toBe(true)
    expect(isJsonValue(Object.assign(Object.create(null), { count: 2 }))).toBe(true)
    expect(isJsonValue(runInNewContext('({ list: [null, 3] })'))).toBe(true)
    let deep: unknown = null
    for (let index = 0; index < 20000; index++) deep = { child: deep }
    expect(isJsonValue(deep)).toBe(true)
  })

  it('rejects data JSON would lose and accepts shared acyclic references', () => {
    const cycle: Record<string, unknown> = {}
    cycle.self = cycle
    const hidden = Object.defineProperty({}, 'hidden', { value: 1 })
    const symbol = { [Symbol('key')]: 1 }
    for (const value of [undefined, NaN, Infinity, -0, 1n, () => {}, new Date(), [, 1], hidden, symbol, cycle]) {
      expect(isJsonValue(value)).toBe(false)
    }
    const shared = { value: 1 }
    expect(isJsonValue({ left: shared, right: shared })).toBe(true)
  })

  it('reads each property once and propagates the original getter failure', () => {
    let reads = 0
    expect(isJsonValue({ get value() { reads++; return 1 } })).toBe(true)
    expect(reads).toBe(1)
    const failure = new Error('getter failed')
    expect(() => isJsonValue({ get value() { throw failure } })).toThrow(failure)
  })
})
