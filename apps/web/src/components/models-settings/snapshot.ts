/** Minimal adapter of Harness runtime/contract/store.ts; React binding stays in index.tsx. */
import { createStore } from 'zustand/vanilla'
import { produce } from 'immer'
export interface SnapshotStore<T> { getSnapshot(): T; subscribe(listener: () => void): () => void; update(mutator: (state: T) => void): void; set(next: T): void }
export type SnapshotSelectorHook<T> = <V>(selector: (snapshot: T) => V) => V
export function createSnapshotStore<T>(initial: T): SnapshotStore<T> {
  const store = createStore<T>(() => initial)
  return {
    getSnapshot: store.getState, subscribe: store.subscribe,
    update: mutator => store.setState(produce(store.getState(), draft => { mutator(draft as T) }), true),
    set: next => store.setState(next, true),
  }
}
