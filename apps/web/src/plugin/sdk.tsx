import { createContext, useContext, useSyncExternalStore, type AnchorHTMLAttributes, type ComponentType, type ReactNode } from 'react'
import type { Context, Fiber } from 'cordis'
import type { ClientManifest, Diagnostic, JsonObject, JsonSchema, LocalizedText, TaskView } from './contracts'
export type * from './contracts'

export const SDK_VERSION = '1.0.0'
export interface Observable<T> { subscribe(listener: () => void): () => void; getSnapshot(): T }
export type RouteProps = { params: Record<string, string> }
export type RouteEntry = { id: string; path: string; component: ComponentType<RouteProps>; access: 'public' | 'authenticated' }
export type NavigationEntry = { id: string; label: LocalizedText; routeId: string; order?: number; icon?: ComponentType<{ className?: string }> }
export type EditorProps = { value: JsonObject; schema: JsonSchema; diagnostics: Diagnostic[]; readOnly: boolean; onChange(value: JsonObject): void }
export type PanelProps = { task: TaskView; refresh(): void }
export type SettingsSectionProps = { settings: JsonObject; save(patch: JsonObject): Promise<void> }
export type SlotMap = {
  root: { id: string; component: ComponentType }
  'shell.routes': RouteEntry
  'shell.navigation': NavigationEntry
  'config.editors': { id: string; component: ComponentType<EditorProps> }
  'task.detail.panels': { id: string; order?: number; component: ComponentType<PanelProps> }
  'task.detail.actions': { id: string; order?: number; component: ComponentType<PanelProps> }
  'settings.sections': { id: string; order?: number; component: ComponentType<SettingsSectionProps> }
}
export interface Slots extends Observable<number> {
  register<K extends keyof SlotMap>(slot: K, entry: SlotMap[K]): () => void
  list<K extends keyof SlotMap>(slot: K): SlotMap[K][]
}
export interface Navigation extends Observable<string> {
  push(path: string): void; replace(path: string): void; href(routeId: string, params?: Record<string, string>): string
}
export interface ApiClient {
  request<T>(path: string, init?: RequestInit): Promise<T>
  setCsrf(token: string): void; clearSession(): void; abortReads(): void
}
export type SessionSnapshot = { status: 'loading' | 'anonymous' | 'authenticated' | 'error'; error?: string }
export interface Session extends Observable<SessionSnapshot> { login(password: string): Promise<void>; logout(): Promise<void>; expire(): Promise<void> }
export interface ClientModules { mountAuthenticated(): Promise<void>; unmountAuthenticated(): Promise<void> }
declare module 'cordis' {
  interface Context { slots: Slots; navigation: Navigation; apiClient: ApiClient; session: Session; clientModules: ClientModules }
}

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
export function text(value: LocalizedText | undefined, language = 'zh'): string {
  return typeof value === 'string' ? value : value?.translations?.[language] ?? value?.default ?? ''
}
export function matchRoute(path: string, pattern: string): Record<string, string> | null {
  const parts = path.split('/').filter(Boolean), tokens = pattern.split('/').filter(Boolean)
  if (parts.length !== tokens.length) return null
  const params: Record<string, string> = {}
  for (let index = 0; index < tokens.length; index++) {
    if (tokens[index].startsWith(':')) {
      try { params[tokens[index].slice(1)] = decodeURIComponent(parts[index]) } catch { return null }
    } else if (tokens[index] !== parts[index]) return null
  }
  return params
}
export function parseManifest(value: unknown): ClientManifest {
  const manifest = value as ClientManifest
  if (!manifest || manifest.version !== 1 || manifest.sdkVersion !== SDK_VERSION || manifest.platformVersion !== '1' || !Array.isArray(manifest.modules)) throw new Error('Client manifest version is unsupported')
  const ids = new Set<string>()
  for (const entry of manifest.modules) {
    if (!entry.id || ids.has(entry.id) || !entry.version || !['public', 'authenticated'].includes(entry.access) || !entry.url?.startsWith('/') || entry.url.startsWith('//')) throw new Error(`Invalid Client module: ${entry.id}`)
    if (entry.css?.some((url) => !url.startsWith('/') || url.startsWith('//'))) throw new Error(`Invalid CSS URL: ${entry.id}`)
    ids.add(entry.id)
  }
  return manifest
}
export async function requireActive(fiber: Fiber, name: string) {
  await fiber
  if (fiber.state !== 2) throw new Error(`Plugin ${name} failed to activate (state ${fiber.state})`)
}
