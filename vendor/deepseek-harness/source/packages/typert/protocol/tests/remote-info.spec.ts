/** Factory regressions without loading a Controller or a Remote runtime. */

import { expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createTypertRemoteInfo } from '../src/remote-info.ts'
import type { TypertRemoteSpec } from '../src/types.ts'

it('lazily indexes endpoints once and preserves wire aliases and codecs without constructing parsers', () => {
  const create = vi.fn(() => { throw new Error('invalid schema factory') })
  const codec = { mode: 'strict' as const, typeSymbol: 'fixture#Text', create }
  const methods = vi.fn((): TypertRemoteSpec['methods'] => ({
    'goals/create': {
      service: 'goals', invocation: { kind: 'direct' },
      parameters: [
        { name: 'agent', wire: 'agentId', source: 'lookup', lookup: 'agent', codec },
        { name: 'label', source: 'json', acceptsUndefined: true, codec },
      ],
      scope: { context: 'agent', wire: 'agentId' }, cancellation: { parameter: 'signal' },
      result: { ...codec, description: 'Created goal.' },
    },
  }))
  const info = createTypertRemoteInfo({ package: 'fixture', get methods() { return methods() } })
  expect(info.package).toBe('fixture')
  expect(methods).not.toHaveBeenCalled()
  const [descriptor] = info.descriptors
  expect(descriptor).toMatchObject({
    id: 'fixture#goals/create', namespace: 'goals', method: 'create',
    parameters: [{ wire: 'agentId', codec }, { wire: 'label', acceptsUndefined: true, codec }],
    scope: { context: 'agent', wire: 'agentId' }, cancellation: { parameter: 'signal' },
    result: { description: 'Created goal.' },
  })
  expect(info.descriptors).toBe(info.descriptors)
  expect(methods).toHaveBeenCalledTimes(1)
  expect(create).not.toHaveBeenCalled()
  expect(() => (descriptor!.result as typeof codec).create()).toThrow('invalid schema factory')
})

it('retains Context receivers and streaming codecs', () => {
  const codec = { mode: 'strict' as const, typeSymbol: 'fixture#Text', create: () => z.string() }
  const definition = {
    service: 'goals', invocation: { kind: 'context' as const, context: 'agent', wire: 'agentId', codec },
    implementation: 'watchCurrent', mode: 'stream' as const, parameters: [], uplink: { codec }, result: codec,
  }
  const [descriptor] = createTypertRemoteInfo({ package: 'fixture', methods: { 'goals/watch': definition } }).descriptors
  expect(descriptor).toMatchObject({ ...definition, namespace: 'goals', method: 'watch' })
  expect(descriptor!.result).toBe(codec)
  expect(descriptor!.uplink).toBe(definition.uplink)
})
