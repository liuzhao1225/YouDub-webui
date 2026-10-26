import { afterEach, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { ConnectionRpcHandler } from '@deepseek-ai/dsh-client-connection'
import { Remote, TypertRemoteService, type Principal } from '@deepseek-ai/dsh-typert-protocol'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import TypertGatewayService from '../src/index.ts'
import { REMOTE_EVENT_STREAM_ENDPOINT } from '../src/stream-protocol.ts'
import { ownerPeer, peerFor } from './peer.ts'

class OwnerFixture extends TypertRemoteService {
  calls = 0
  constructor(ctx: Context) { super(ctx, 'ownerFixture') }
  @Remote
  read(): string { this.calls++; return 'ready' }
  @Remote({ mode: 'stream' })
  *follow(): Iterable<string> { this.calls++; yield 'ready' }
}

const contexts: Context[] = []
afterEach(async () => { await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose())) })
async function setup() {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(TypertRegistry)
  await ctx.plugin(TypertGatewayService)
  const service = new OwnerFixture(ctx)
  const guest = peerFor(ctx, { kind: 'unsupported' } as unknown as Principal)
  return { ctx, service, guest }
}

it('dispatches owner calls and refuses other principals before resolving a receiver', async () => {
  const { ctx, service, guest } = await setup()
  const request = { namespace: 'ownerFixture', method: 'read', args: {} }
  await expect(ctx.typertGateway.invoke({ ...request, peer: ownerPeer(ctx) })).resolves.toBe('ready')
  await expect(ctx.typertGateway.invoke({ ...request, peer: guest })).rejects.toMatchObject({
    code: 'remote-access/denied', details: { action: 'ownerFixture/read', reason: 'owner-required' },
  })
  await expect(ctx.typertGateway.invoke({ ...request, namespace: 'missing', peer: guest })).rejects.toMatchObject({
    code: 'remote-access/denied', details: { reason: 'owner-required' },
  })
  expect(service.calls).toBe(1)
})

it('returns an RPC denial without invoking the non-owner request handler', async () => {
  const { ctx, service, guest } = await setup()
  const gateway = ctx.typertGateway as unknown as { invokeRpc: ConnectionRpcHandler }
  await expect(gateway.invokeRpc('ownerFixture/read', { args: {} }, new AbortController().signal, guest))
    .resolves.toMatchObject({
      ok: false,
      error: { code: 'remote-access/denied', details: { action: 'ownerFixture/read', reason: 'owner-required' } },
    })
  expect(service.calls).toBe(0)
})

it.each(['ownerFixture/follow', REMOTE_EVENT_STREAM_ENDPOINT])(
  'refuses non-owner %s streams before publishing data', async endpoint => {
    const { ctx, service, guest } = await setup()
    const empty: AsyncIterable<never> = { async *[Symbol.asyncIterator]() {} }
    await expect(ctx.typertGateway.wireStream.open(endpoint, { args: {} }, empty, guest, new AbortController().signal))
      .rejects.toMatchObject({ code: 'remote-access/denied', details: { action: endpoint, reason: 'owner-required' } })
    expect(service.calls).toBe(0)
  },
)
