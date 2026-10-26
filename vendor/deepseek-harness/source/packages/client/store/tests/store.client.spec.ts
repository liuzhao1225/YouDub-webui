import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSnapshotStore, defineStore } from '../src/index.ts'

interface State {
  a: { n: number }
  b: { list: string[] }
}

const init = (): State => ({ a: { n: 1 }, b: { list: ['x'] } })

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('createSnapshotStore', () => {
  it('applies update through a draft and preserves untouched branch references', () => {
    const store = createSnapshotStore(init())
    const before = store.getSnapshot()
    store.update((d) => { d.a.n = 2 })
    const after = store.getSnapshot()
    expect(after).not.toBe(before)
    expect(after.a.n).toBe(2)
    expect(after.b).toBe(before.b)
  })

  it('notifies synchronously per update by default', () => {
    const store = createSnapshotStore(init())
    const seen: number[] = []
    store.subscribe(() => { seen.push(store.getSnapshot().a.n) })
    store.update((d) => { d.a.n = 2 })
    store.update((d) => { d.a.n = 3 })
    expect(seen).toEqual([2, 3])
  })

  it('replaces state wholesale via set and freezes it outside production', () => {
    const store = createSnapshotStore(init())
    const next = init()
    store.set(next)
    expect(store.getSnapshot()).toBe(next)
    expect(() => { (store.getSnapshot().a).n = 9 }).toThrow()
  })

  it('freezes the owned envelope without traversing opaque object handles', () => {
    class OpaqueHandle {
      readonly value = { n: 1 }
    }
    const handle = new OpaqueHandle()
    const store = createSnapshotStore({ handle, values: new Set(['x']) })

    store.set({ handle, values: new Set(['y']) })

    const snapshot = store.getSnapshot()
    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(Object.isFrozen(snapshot.handle)).toBe(false)
    expect(() => { snapshot.values.add('z') }).toThrow()
  })

  it('freezes update produce output outside production (immer dev freeze)', () => {
    const store = createSnapshotStore(init())
    store.update((d) => { d.a.n = 2 })
    expect(() => { (store.getSnapshot().a).n = 9 }).toThrow()
  })

  it('does not deep-freeze wholesale state in production', () => {
    vi.stubEnv('NODE_ENV', 'production')
    const store = createSnapshotStore(init())
    const next = init()
    store.set(next)

    next.a.n = 9
    expect(store.getSnapshot().a.n).toBe(9)
  })

  it('rehydrates primitive state whole, not spread into index keys', () => {
    const backing = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => backing.get(k) ?? null,
      setItem: (k: string, v: string) => { backing.set(k, v) },
      removeItem: (k: string) => { backing.delete(k) },
    })
    const store = createSnapshotStore<string>('', { persist: { name: 'spec-draft' } })
    store.set('hello')
    const revived = createSnapshotStore<string>('', { persist: { name: 'spec-draft' } })
    expect(revived.getSnapshot()).toBe('hello')
  })

  it('persists to localStorage under the given name and rehydrates', () => {
    const backing = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => backing.get(k) ?? null,
      setItem: (k: string, v: string) => { backing.set(k, v) },
      removeItem: (k: string) => { backing.delete(k) },
    })
    const store = createSnapshotStore(init(), { persist: { name: 'spec-store' } })
    store.update((d) => { d.a.n = 42 })
    expect(backing.has('spec-store')).toBe(true)
    const revived = createSnapshotStore(init(), { persist: { name: 'spec-store' } })
    expect(revived.getSnapshot().a.n).toBe(42)
  })

  it('reports rehydration failures without preventing store creation', () => {
    const failure = new Error('storage read failed')
    vi.stubGlobal('localStorage', {
      getItem: () => { throw failure },
      setItem: () => {},
      removeItem: () => {},
    })
    const report = vi.spyOn(console, 'error').mockImplementation(() => {})

    const store = createSnapshotStore(init(), { persist: { name: 'spec-broken-read' } })

    expect(store.getSnapshot()).toEqual(init())
    expect(report).toHaveBeenCalledWith(
      "snapshot store 'spec-broken-read' rehydration failed:",
      failure,
    )
  })

  it('reports persistence failures without rejecting the write', () => {
    const failure = new Error('storage write failed')
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => { throw failure },
      removeItem: () => {},
    })
    const report = vi.spyOn(console, 'error').mockImplementation(() => {})
    const store = createSnapshotStore(init(), { persist: { name: 'spec-broken-write' } })

    expect(() => { store.update((draft) => { draft.a.n = 7 }) }).not.toThrow()
    expect(store.getSnapshot().a.n).toBe(7)
    expect(report).toHaveBeenCalledWith(
      "snapshot store 'spec-broken-write' persistence failed:",
      failure,
    )
  })
})

describe('defineStore', () => {
  const declare = () => defineStore({
    init: () => ({ selection: null as string | null, draft: '' }),
    actions: {
      select: (d, target: string) => { d.selection = target },
      setDraft: (d, text: string) => { d.draft = text },
      clearDraft: (d) => { d.draft = '' },
    },
  })

  it('create() yields a live instance: fresh init state, selector-visible action writes', () => {
    const inst = declare().create()
    expect(inst.getSnapshot()).toEqual({ selection: null, draft: '' })
    const listener = vi.fn()
    const unsubscribe = inst.subscribe(listener)
    inst.actions.setDraft('hello')
    inst.actions.select('m1')
    expect(inst.store.getSnapshot()).toEqual({ selection: 'm1', draft: 'hello' })
    expect(listener).toHaveBeenCalledTimes(2)
    unsubscribe()
    inst.actions.clearDraft()
    expect(inst.store.getSnapshot().draft).toBe('')
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('bakes draft-stripped actions that write through update (draft mutation, not replacement)', () => {
    const inst = declare().create()
    const before = inst.store.getSnapshot()
    inst.actions.setDraft('x')
    const after = inst.store.getSnapshot()
    expect(after).not.toBe(before)
    expect(after.selection).toBe(before.selection)   // untouched branch preserved (immer path)
  })

  it('creates independent instances per create() call (the handle is a spec, not a singleton)', () => {
    const handle = declare()
    const a = handle.create()
    const b = handle.create()
    a.actions.setDraft('only-a')
    expect(b.store.getSnapshot().draft).toBe('')
  })

  it('persists and restores a root store under its declared key', () => {
    const backing = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => backing.get(key) ?? null,
      setItem: (key: string, value: string) => { backing.set(key, value) },
    })
    const handle = defineStore({
      init: () => ({ draft: '' }),
      persist: 'spec.draft',
      actions: { setDraft: (draft, text: string) => { draft.draft = text } },
    })
    handle.create().actions.setDraft('saved')
    expect(JSON.parse(backing.get('spec.draft')!)).toEqual({ draft: 'saved' })
    expect(handle.create().getSnapshot().draft).toBe('saved')
  })
})
