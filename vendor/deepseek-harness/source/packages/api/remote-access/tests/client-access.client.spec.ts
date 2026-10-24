import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { HostObservable, RootStandardSourceContribution } from '@deepseek-ai/dsh-client-ui-slots'
import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import type { RemoteAccessFrame } from '../src/types.ts'
import { ClientAccessState, parseInjectedBaseline, type Baseline } from '../src/client/state.ts'
import { mountAccess } from '../src/client/mount.ts'

const GRANTED: Baseline = {
  type: 'baseline',
  owner: false,
  grants: [{ resource: { kind: 'global' }, actions: ['settings/read'] }],
}

describe('ClientAccessState', () => {
  it('answers false before a baseline and after a non-owner stream fails, and true for the owner', () => {
    const state = new ClientAccessState()
    expect(state.global('settings/read').getSnapshot()).toBe(false)
    state.replace({ type: 'baseline', owner: true })
    expect(state.global('settings/read').getSnapshot()).toBe(true)
    state.unavailable()
    expect(state.global('settings/read').getSnapshot()).toBe(true)
    state.replace(GRANTED)
    expect(state.global('settings/read').getSnapshot()).toBe(true)
    expect(state.global('settings/write').getSnapshot()).toBe(false)
    state.unavailable()
    expect(state.global('settings/read').getSnapshot()).toBe(false)
  })

  it('starts from the injected baseline before any stream frame', () => {
    expect(new ClientAccessState({ type: 'baseline', owner: true }).global('settings/write').getSnapshot()).toBe(true)
    const granted = new ClientAccessState(GRANTED)
    expect(granted.global('settings/read').getSnapshot()).toBe(true)
    expect(granted.global('settings/write').getSnapshot()).toBe(false)
  })

  it('validates the injected baseline and refuses malformed or unsupported resource grants', () => {
    expect(parseInjectedBaseline(undefined)).toBeUndefined()
    expect(parseInjectedBaseline({ type: 'baseline', owner: true, extra: 1 })).toEqual({ type: 'baseline', owner: true })
    expect(parseInjectedBaseline(JSON.parse(JSON.stringify(GRANTED)))).toEqual(GRANTED)
    for (const malformed of [
      null, 'baseline', [], { type: 'upsert' },
      { type: 'baseline' }, { type: 'baseline', owner: false }, { type: 'baseline', owner: false, grants: [7] },
      { type: 'baseline', owner: false, grants: [{ resource: { kind: 'removed-resource', id: 'r1' }, actions: [] }] },
      { type: 'baseline', owner: false, grants: [{ resource: { kind: 7 }, actions: [] }] },
      { type: 'baseline', owner: false, grants: [{ resource: { kind: 'global' }, actions: 'settings/read' }] },
      { type: 'baseline', owner: false, grants: [{ resource: { kind: 'global' }, actions: [7] }] },
      { type: 'baseline', owner: false, grants: [{ resource: { kind: 'global' } }] },
      { type: 'baseline', owner: false, grants: [{ scope: { kind: 'page' }, endpoints: ['settings/read'] }] },
    ]) {
      expect(() => parseInjectedBaseline(malformed)).toThrow(TypeError)
    }
  })

  it('applies global upserts and removals and notifies subscribers until they unsubscribe', () => {
    const state = new ClientAccessState(GRANTED)
    const read = state.global('settings/read')
    const listener = vi.fn()
    const unsubscribe = read.subscribe(listener)
    state.update({ type: 'upsert', grant: { resource: { kind: 'global' }, actions: ['settings/write'] } })
    expect(read.getSnapshot()).toBe(false)
    expect(state.global('settings/write').getSnapshot()).toBe(true)
    expect(listener).toHaveBeenCalledOnce()
    state.update({ type: 'remove', resource: { kind: 'global' } })
    expect(state.global('settings/write').getSnapshot()).toBe(false)
    expect(listener).toHaveBeenCalledTimes(2)
    unsubscribe()
    state.update({ type: 'upsert', grant: { resource: { kind: 'global' }, actions: ['settings/read'] } })
    expect(read.getSnapshot()).toBe(true)
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('ignores increments outside a non-owner generation and keeps source identity stable', () => {
    const state = new ClientAccessState()
    state.update({ type: 'upsert', grant: { resource: { kind: 'global' }, actions: ['settings/read'] } })
    expect(state.global('settings/read').getSnapshot()).toBe(false)
    state.replace({ type: 'baseline', owner: true })
    state.update({ type: 'remove', resource: { kind: 'global' } })
    expect(state.global('settings/read').getSnapshot()).toBe(true)
    expect(state.global('settings/read')).toBe(state.global('settings/read'))
    expect(state.global('settings/read')).not.toBe(state.global('settings/write'))
  })
})

interface FakeStreamOptions {
  readonly name: string
  readonly open: (signal: AbortSignal) => unknown
  readonly ended: (accepted: boolean) => Error
}

/** One controllable generation of `remoteAccess/follow`, standing in for the Gateway-owned carrier. */
class FakeAccessStream {
  private readonly frames: RemoteAccessFrame[] = []
  private wake: (() => void) | undefined
  private done = false
  private failure: Error | undefined

  constructor(readonly options: FakeStreamOptions) {}

  push(frame: RemoteAccessFrame): void {
    this.frames.push(frame)
    this.wake?.()
  }

  fail(error: Error): void {
    this.failure = error
    this.wake?.()
  }

  restart(): void {}

  async dispose(): Promise<void> {
    this.done = true
    this.wake?.()
  }

  async *[Symbol.asyncIterator](): AsyncIterator<{
    readonly generation: number
    readonly value: RemoteAccessFrame
    readonly accept: () => void
  }> {
    while (!this.done) {
      if (this.failure !== undefined) throw this.failure
      const frame = this.frames.shift()
      if (frame !== undefined) {
        yield { generation: 1, value: frame, accept: () => {} }
        continue
      }
      await new Promise<void>((resolve) => { this.wake = resolve })
    }
  }
}

function value(source: HostObservable<unknown> | undefined): unknown {
  if (source === undefined) throw new Error('missing source')
  return source.getSnapshot()
}

async function mounted(initial?: Baseline): Promise<{
  readonly ctx: Context
  readonly stream: () => FakeAccessStream
  readonly global: (action: string) => HostObservable<unknown> | undefined
  readonly follow: ReturnType<typeof vi.fn>
  readonly mount: ReturnType<typeof vi.fn>
  readonly unmount: ReturnType<typeof vi.fn>
  readonly contribution: TypertRemoteContribution
  readonly dispose: () => Promise<void>
}> {
  const ctx = new Context()
  let stream: FakeAccessStream | undefined
  const follow = vi.fn()
  const unmount = vi.fn(async () => {})
  const remote = {
    $mount: vi.fn(async () => unmount),
    $stream: (options: FakeStreamOptions) => {
      stream = new FakeAccessStream(options)
      return stream
    },
    remoteAccess: { follow },
  }
  let root: RootStandardSourceContribution | undefined
  ctx.provide('remote', remote as never)
  ctx.provide('slots', {
    provideRoot: (contribution: RootStandardSourceContribution) => {
      root = contribution
      return () => {}
    },
  } as never)
  const contribution: TypertRemoteContribution = { package: '@deepseek-ai/dsh-api-remote-access', descriptors: [] }
  let dispose: (() => Promise<void>) | undefined
  await ctx.plugin({
    inject: ['remote', 'slots'],
    apply: async (pluginCtx: Context) => { dispose = await mountAccess(pluginCtx, contribution, initial) },
  })
  // The generated namespace arrives after the mount, as `$mount` provides it.
  ctx.provide('remote.remoteAccess', remote.remoteAccess as never)
  await vi.waitFor(() => { expect(stream).toBeDefined() })
  return {
    ctx,
    stream: () => stream as FakeAccessStream,
    global: action => root?.keyedHooks?.['remoteAccess']?.(action),
    follow,
    mount: remote.$mount,
    unmount,
    contribution,
    dispose: async () => { await dispose?.() },
  }
}

describe('remote-access Client mount', () => {
  it('provides the global-resource Hook over the followed snapshot', async () => {
    const access = await mounted()
    expect(access.mount).toHaveBeenCalledWith(access.contribution)
    const read = access.global('settings/read')
    const write = access.global('settings/write')
    expect(access.global('settings/read')).toBe(read)
    expect([value(read), value(write)]).toEqual([false, false])

    access.stream().push(GRANTED)
    await vi.waitFor(() => { expect(value(read)).toBe(true) })
    expect(value(write)).toBe(false)
    access.stream().push({ type: 'remove', resource: { kind: 'global' } })
    await vi.waitFor(() => { expect(value(read)).toBe(false) })
    // Reading an answer never issues a request; only the stream factory reaches the namespace.
    expect(access.follow).not.toHaveBeenCalled()
    access.stream().options.open(new AbortController().signal)
    expect(access.follow).toHaveBeenCalledOnce()
    expect(access.stream().options.ended(true).message).toMatch(/without a terminal result/)
    expect(access.stream().options.ended(false).message).toMatch(/before its opening snapshot/)

    await access.dispose()
    expect(access.unmount).toHaveBeenCalledOnce()
  })

  it('answers from the injected baseline at once and false once a non-owner stream fails terminally', async () => {
    const access = await mounted(GRANTED)
    const report = vi.spyOn(access.ctx.logger, 'error').mockImplementation(() => undefined)
    const globalList = access.global('settings/read')
    expect(value(globalList)).toBe(true)
    const failure = new Error('carrier closed for good')
    access.stream().fail(failure)
    await vi.waitFor(() => { expect(value(globalList)).toBe(false) })
    expect(report).toHaveBeenCalledWith('access snapshot stream failed; reload the page to reconnect', failure)
    await access.dispose()
  })

  it('keeps the owner\'s answers when its stream fails terminally', async () => {
    const access = await mounted({ type: 'baseline', owner: true })
    const report = vi.spyOn(access.ctx.logger, 'error').mockImplementation(() => undefined)
    const globalFork = access.global('settings/write')
    expect(value(globalFork)).toBe(true)
    const failure = new Error('carrier closed for good')
    access.stream().fail(failure)
    await vi.waitFor(() => { expect(report).toHaveBeenCalledOnce() })
    expect(report).toHaveBeenCalledWith('access snapshot stream failed; owner access answers are unaffected', failure)
    expect(value(globalFork)).toBe(true)
    await access.dispose()
  })
})
