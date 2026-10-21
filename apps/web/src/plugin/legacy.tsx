/** Compatibility adapter for SDK 1.1 plugins; built-in feature components use bound props. */
import { createContext, useContext, useSyncExternalStore, type AnchorHTMLAttributes, type ReactNode } from 'react'
import type { Context } from 'cordis'
import type { Observable, SlotMap } from './sdk'
const ClientContext = createContext<Context | null>(null)
export function PluginContextProvider({ context, children }: { context: Context; children: ReactNode }) {
  return <ClientContext.Provider value={context}>{children}</ClientContext.Provider>
}
export function useClient(): Context {
  const context = useContext(ClientContext)
  if (!context) throw new Error('Plugin component requires the Client context')
  return context
}
export function useObservable<T>(source: Observable<T>): T {
  return useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot)
}
export function useSlot<K extends keyof SlotMap>(slot: K): SlotMap[K][] {
  const { slots } = useClient()
  useObservable(slots)
  return slots.list(slot)
}
export function usePathname() { return useObservable(useClient().navigation).split('?')[0] }
export function Link({ href = '/', onClick, children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  const navigation = useClient().navigation
  return <a {...props} href={href} onClick={(event) => {
    onClick?.(event)
    if (!event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && !props.target && href.startsWith('/')) {
      event.preventDefault(); navigation.push(href)
    }
  }}>{children}</a>
}
