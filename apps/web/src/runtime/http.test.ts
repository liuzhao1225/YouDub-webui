import { describe, expect, it } from 'vitest'
import { HttpError, responseBody } from './http'

describe('shared HTTP response parsing', () => {
  it('preserves proxy status and original non-JSON diagnostics', async () => {
    const response = new Response('<html>upstream connection refused</html>', { status: 502, headers: { 'content-type': 'text/html' } })
    await expect(responseBody(response)).rejects.toMatchObject({ status: 502, message: 'HTTP 502: <html>upstream connection refused</html>' })
  })
  it('preserves structured validation details', async () => {
    const response = Response.json({ error: { code: 'INVALID_CONFIG', message: 'Missing model', details: { field: 'model' } } }, { status: 422 })
    await expect(responseBody(response)).rejects.toEqual(new HttpError('Missing model', 422, 'INVALID_CONFIG', { field: 'model' }))
  })
  it('supports JSON, text and empty successful responses', async () => {
    expect(await responseBody(Response.json({ ready: true }))).toEqual({ ready: true })
    expect(await responseBody(new Response('original log'))).toBe('original log')
    expect(await responseBody(new Response(null, { status: 204 }))).toBeUndefined()
  })
})
