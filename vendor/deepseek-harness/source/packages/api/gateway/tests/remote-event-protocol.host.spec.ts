import { describe, expect, it } from 'vitest'
import { isRemoteJsonValue } from '@deepseek-ai/dsh-typert-protocol'
import {
  parseRemoteStreamClientMessage,
} from '../src/stream-protocol.ts'

describe('Remote Event JSON values', () => {
  it('accepts lossless JSON values, null-prototype objects, and repeated references', () => {
    const shared = { value: 1 }
    const nullPrototype = Object.assign(Object.create(null) as Record<string, unknown>, {
      enabled: true,
    })
    expect(isRemoteJsonValue({
      null: null,
      string: 'value',
      boolean: true,
      number: 1.5,
      array: [shared, shared],
      nullPrototype,
    })).toBe(true)
  })

  it.each([
    undefined,
    1n,
    Symbol('value'),
    () => undefined,
    NaN,
    Number.POSITIVE_INFINITY,
    -0,
  ])('rejects a non-lossless scalar: %s', (value) => {
    expect(isRemoteJsonValue(value)).toBe(false)
  })

  it('rejects cycles and non-plain arrays and objects', () => {
    const cycle: Record<string, unknown> = {}
    cycle.self = cycle
    expect(isRemoteJsonValue(cycle)).toBe(false)

    class Fixture {
      value = 1
    }
    expect(isRemoteJsonValue(new Fixture())).toBe(false)

    const customArray = [1]
    Object.setPrototypeOf(customArray, null)
    expect(isRemoteJsonValue(customArray)).toBe(false)
    expect(isRemoteJsonValue(Object.assign([1], { extra: true }))).toBe(false)

    const sparse = new Array<unknown>(2)
    sparse[1] = 'value'
    expect(isRemoteJsonValue(sparse)).toBe(false)
    const disguisedSparse = Object.assign(new Array<unknown>(2), { extra: true })
    disguisedSparse[1] = 'value'
    expect(isRemoteJsonValue(disguisedSparse)).toBe(false)
    expect(isRemoteJsonValue([undefined])).toBe(false)

    const symbolic = { [Symbol('value')]: true }
    expect(isRemoteJsonValue(symbolic)).toBe(false)
    const hidden = {}
    Object.defineProperty(hidden, 'value', { value: true })
    expect(isRemoteJsonValue(hidden)).toBe(false)
    expect(isRemoteJsonValue({ nested: undefined })).toBe(false)
  })
})

describe('Remote stream client protocol', () => {
  it('rejects the removed logical-stream input message', () => {
    expect(() => parseRemoteStreamClientMessage(JSON.stringify({
      type: 'input', streamId: 'stream-1', value: { answer: true },
    }))).toThrow('api gateway: invalid Remote stream client message')
  })
})
