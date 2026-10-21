import type { Credential } from '@earendil-works/pi-ai'
import type { PiAiAuthInjection } from '../src/adapter.ts'

/**
 * The auth injectables for tests that exercise streaming rather than
 * authentication: an in-process credential store and an ambient context that
 * finds nothing. A test needing real records builds the store over
 * `ctx.credentials` instead, through `credentialStoreFrom`.
 * @param seed - credentials to start with, by pi-ai provider id.
 * @returns the injection to hand `PiAiAdapter`, with its store readable.
 */
export function memoryAuth(seed: Record<string, Credential> = {}): PiAiAuthInjection & {
  stored: Map<string, Credential>
} {
  const stored = new Map(Object.entries(seed))
  return {
    stored,
    credentials: {
      read: id => Promise.resolve(stored.get(id)),
      list: () => Promise.resolve([...stored].map(([providerId, credential]) => ({
        providerId,
        type: credential.type,
      }))),
      async modify(id, mutate) {
        const next = await mutate(stored.get(id))
        if (next !== undefined) stored.set(id, next)
        return stored.get(id)
      },
      delete: (id) => {
        stored.delete(id)
        return Promise.resolve()
      },
    },
    authContext: {
      env: () => Promise.resolve(undefined),
      fileExists: () => Promise.resolve(false),
    },
  }
}
