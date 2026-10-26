/** React lifecycle helpers shared by domain views; no client framework boot. */
import { useEffect, useRef, useSyncExternalStore } from 'react'
import type { Observable } from './runtime/types'

export function useObservableSource<T>(source: Observable<T>): T {
  return useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot)
}
export function useActiveView() {
  const active = useRef(true)
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  return active
}
export function usePendingUnload(pending: boolean) {
  useEffect(() => {
    if (!pending) return
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', unload)
    return () => window.removeEventListener('beforeunload', unload)
  }, [pending])
}
