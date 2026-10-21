export class HttpError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string, readonly details?: unknown) { super(message); this.name = 'HttpError' }
}

/** Preserve HTTP failures even when a proxy responds with plain text or HTML. */
export async function responseBody<T>(response: Response): Promise<T> {
  const body = response.status === 204 ? '' : await response.text()
  if (!response.ok) {
    let detail: { error?: { message?: string; code?: string; details?: unknown }; detail?: string } | null = null
    try { detail = JSON.parse(body) } catch { /* Keep the original response as the diagnostic. */ }
    throw new HttpError(detail?.error?.message || detail?.detail || `HTTP ${response.status}: ${body.slice(0, 500) || response.statusText}`, response.status, detail?.error?.code, detail?.error?.details)
  }
  if (!body) return undefined as T
  if (response.headers.get('content-type')?.includes('application/json')) return JSON.parse(body) as T
  return body as T
}
