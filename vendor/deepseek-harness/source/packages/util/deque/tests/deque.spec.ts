import { describe, expect, it } from 'vitest'
import { Deque } from '@deepseek-ai/dsh-deque'

function backingStorage<T>(deque: Deque<T>): readonly (T | undefined)[] {
  // Storage retention is the behavior under test and has no public query API.
  return (deque as unknown as { readonly buffer: readonly (T | undefined)[] }).buffer
}

describe('Deque', () => {
  it('removes tail-appended entries in FIFO order', () => {
    const deque = new Deque<number>()
    expect(deque.size).toBe(0)
    expect(deque.popFront()).toBeUndefined()

    deque.pushBack(1)
    deque.pushBack(2)

    expect(deque.size).toBe(2)
    expect(deque.popFront()).toBe(1)
    expect(deque.popFront()).toBe(2)
    expect(deque.size).toBe(0)
  })

  it('prepends entries before the existing head', () => {
    const deque = new Deque<number>()
    deque.pushBack(3)
    deque.pushFront(2)
    deque.pushFront(1)

    expect([deque.popFront(), deque.popFront(), deque.popFront()]).toEqual([1, 2, 3])
  })

  it('appends through the array boundary without growing', () => {
    const deque = new Deque<number>()
    for (let value = 0; value < 8; value += 1) deque.pushBack(value)
    for (let value = 0; value < 6; value += 1) expect(deque.popFront()).toBe(value)
    for (let value = 8; value <= 16; value += 1) deque.pushBack(value)

    for (const value of [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]) {
      expect(deque.popFront()).toBe(value)
    }
  })

  it('preserves order across wrapping, growth, and sparse compaction', () => {
    const deque = new Deque<number>()
    for (let value = 0; value < 32; value += 1) deque.pushBack(value)
    for (let value = 0; value < 24; value += 1) expect(deque.popFront()).toBe(value)
    expect(backingStorage(deque)).toHaveLength(16)
    for (let value = 32; value < 128; value += 1) deque.pushBack(value)

    for (let value = 24; value < 128; value += 1) expect(deque.popFront()).toBe(value)
    expect(deque.size).toBe(0)
    expect(backingStorage(deque)).toHaveLength(16)
  })

  it('releases a removed reference before sparse compaction', () => {
    const deque = new Deque<object>()
    const removed = {}
    deque.pushBack(removed)
    deque.pushBack({})

    expect(deque.popFront()).toBe(removed)
    expect(backingStorage(deque)).not.toContain(removed)
    expect(backingStorage(deque)).toHaveLength(16)
  })

  it('drops retained storage and remains reusable after clear', () => {
    const deque = new Deque<object>()
    const retained = {}
    deque.pushBack(retained)
    for (let index = 1; index < 64; index += 1) deque.pushBack({ index })
    const grownStorage = backingStorage(deque)

    deque.clear()
    expect(deque.size).toBe(0)
    expect(deque.popFront()).toBeUndefined()
    expect(backingStorage(deque)).not.toBe(grownStorage)
    expect(backingStorage(deque)).not.toContain(retained)
    expect(backingStorage(deque)).toHaveLength(16)

    const value = {}
    deque.pushBack(value)
    expect(deque.popFront()).toBe(value)
  })

  it('uses size to distinguish an undefined entry from an empty deque', () => {
    const deque = new Deque<undefined>()
    deque.pushBack(undefined)

    expect(deque.size).toBe(1)
    deque.popFront()
    expect(deque.size).toBe(0)
  })
})
