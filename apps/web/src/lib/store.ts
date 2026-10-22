/** Preserve domain-controller partial updates while Harness owns snapshot storage. */
import { createSnapshotStore } from './harness-store'

export function createStore<T>(initial: () => T) {
  const value = initial(), state = createSnapshotStore(value)
  return {
    getState: state.getSnapshot,
    getInitialState: () => value,
    subscribe: state.subscribe,
    setState(next: Partial<T> | T | ((current: T) => Partial<T> | T), replace = false) {
      const current = state.getSnapshot()
      const update = typeof next === 'function' ? (next as (value: T) => Partial<T> | T)(current) : next
      state.set(replace ? update as T : { ...current, ...update })
    },
  }
}
export type StoreApi<T> = ReturnType<typeof createStore<T>>
