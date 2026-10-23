import { HttpError } from '@/runtime/http'
import type { Request } from '@/plugin/runtime/types'
import type { IApiClient, Result } from './types'

/** Preserve the upstream result envelope without changing YouDub's HTTP/session owner. */
export function modelsApi(request: Request): IApiClient {
  async function call<T>(path: string, method = 'GET', body?: unknown): Promise<Result<T>> {
    try {
      const value = await request<T>(`/api/v2/models/${path}`, { method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) })
      return { result: { ok: true, value } }
    } catch (error) {
      if (!(error instanceof HttpError)) throw error
      return { result: { ok: false, error: { code: error.code ?? `HTTP_${error.status}`, message: error.message } } }
    }
  }
  return {
    llm: { providers: () => call('providers'), discoverModels: input => call('discover', 'POST', input) },
    settings: { describe: () => call('settings'), mutate: input => call('settings', 'PATCH', input) },
    credentials: {
      describe: input => call('credentials/describe', 'POST', input),
      set: ({ ref, value }) => call(`credentials/${encodeURIComponent(ref)}`, 'PUT', { value }),
      unset: ({ ref }) => call(`credentials/${encodeURIComponent(ref)}`, 'DELETE'),
    },
  }
}
