/**
 * The `node:http` seam the worker's webserver boots through: no socket exists,
 * so `createServer` retains the request listener for the tunnel to feed and
 * `listen` reports success on its own.
 *
 * Two failure modes make this worth pinning rather than trusting. A `listen`
 * that never invokes its callback leaves the webserver fiber in LOADING with no
 * error anywhere, and a capture the tunnel misses leaves every synthesized
 * request unanswered — both look like a hang, not a fault.
 *
 * The capture is module state, so the cases below run in order: the first
 * observes the empty slot before anything fills it.
 */
import { describe, expect, it } from 'vitest'
import {
  createServer, get, request, requestListener, ServerResponse, STATUS_CODES, whenRequestListener,
} from '../../src/node/builtin_modules/implemented/http.ts'
import type { RequestListener } from '../../src/transport/synthetic-http.ts'

const listener: RequestListener = () => {}

describe('request listener capture', () => {
  it('keeps a caller waiting until the webserver installs its listener', async () => {
    expect(requestListener()).toBeUndefined()
    let settled = false
    const awaited = whenRequestListener().then((captured) => {
      settled = true
      return captured
    })
    await Promise.resolve()
    expect(settled).toBe(false)
    createServer(listener)
    expect(await awaited).toBe(listener)
  })

  it('answers a later caller from the capture instead of waiting again', async () => {
    expect(requestListener()).toBe(listener)
    expect(await whenRequestListener()).toBe(listener)
  })

  it('holds the capture across a server created without a listener', () => {
    // The tunnel reads one listener; an unrelated createServer must not blank it.
    createServer()
    expect(requestListener()).toBe(listener)
  })
})

describe('binding', () => {
  it('exposes the response prototype middleware probes during module loading', () => {
    expect(ServerResponse.prototype).not.toHaveProperty('appendHeader')
  })

  it('reports the bind through the callback the webserver fiber waits on', async () => {
    const server = createServer(listener)
    let bound = false
    expect(server.listen(3080, () => { bound = true })).toBe(server)
    await Promise.resolve()
    expect(bound).toBe(true)
  })

  it('reports the loopback authority the tunnel synthesizes requests against', () => {
    expect(createServer(listener).address()).toEqual({ address: '127.0.0.1', family: 'IPv4', port: 3080 })
  })

  it('completes close without a socket to release', async () => {
    const server = createServer(listener)
    let closed = false
    server.close(() => { closed = true })
    server.closeAllConnections()
    server.closeIdleConnections()
    await Promise.resolve()
    expect(closed).toBe(true)
  })
})

describe('outbound requests', () => {
  it('refuses, naming the carrier the worker does have', () => {
    expect(() => request()).toThrow(/node:http\.request is not available.*use fetch/)
    expect(() => get()).toThrow(/node:http\.get is not available.*use fetch/)
  })

  it('publishes the status texts a handler writes by hand', () => {
    expect([STATUS_CODES[200], STATUS_CODES[404], STATUS_CODES[503]]).toEqual([
      'OK', 'Not Found', 'Service Unavailable',
    ])
  })
})
