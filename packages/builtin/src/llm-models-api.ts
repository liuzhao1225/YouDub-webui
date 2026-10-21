import type { Context } from 'cordis'
import { readJson, type HttpRequest } from './http.js'
import './llm-models.js'
export const name = 'llm-models-api'
export const inject = ['http', 'auth', 'models']
export function apply(ctx: Context) {
  const route = (method: string, path: string, handler: (request: HttpRequest) => unknown) => ctx.effect(() => ctx.http.register(method, '/api/v2/models' + path, async request => { ctx.http.json(request, 200, await handler(request)) }))
  route('GET', '/providers', () => ctx.models.providers())
  route('GET', '/settings', () => ctx.models.describe())
  route('PATCH', '/settings', async request => ctx.models.mutate(await readJson(request)))
  route('POST', '/credentials/describe', async request => ctx.models.credentialsDescribe(await readJson(request)))
  route('PUT', '/credentials/:ref', async request => ctx.models.credentialsSet(request.params.ref!, (await readJson(request)).value))
  route('DELETE', '/credentials/:ref', request => ctx.models.credentialsUnset(request.params.ref!))
  route('POST', '/discover', async request => ctx.models.discover(await readJson(request)))
}
