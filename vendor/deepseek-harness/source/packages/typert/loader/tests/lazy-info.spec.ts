/** Loading a generated contribution must not materialize its schemas. */

import { expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createTypertRemoteInfo } from '@deepseek-ai/dsh-typert-protocol/remote-info'
import { validateTypertManifest } from '../src/index.ts'

it('validates invocation facts without materializing schemas', () => {
  const create = vi.fn(() => z.string())
  const codec = { mode: 'strict' as const, typeSymbol: 'pkg#Text', create }
  const info = createTypertRemoteInfo({ package: 'pkg', methods: {
    'goals/create': {
      service: 'goals', invocation: { kind: 'direct' },
      parameters: [{ name: 'request', source: 'json', codec }],
      result: { ...codec, description: 'Created goal.' },
    },
  } })
  const manifest = { package: 'pkg', face: 'host', schemas: [], model: { services: [], events: [], objects: [] }, invocations: info.descriptors }
  expect(validateTypertManifest('pkg', manifest)).toBe(manifest)
  expect(create).not.toHaveBeenCalled()
  expect(manifest.invocations[0]!.parameters[0]!.codec).toBe(codec)
})
