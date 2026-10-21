import type { ComponentType } from 'react'
import type { Fiber } from 'cordis'
import type { ClientManifest, Diagnostic, GraphNode, JsonObject, JsonSchema, LocalizedText, NodeTypeDefinition, TaskNodeDetail, TaskView } from './contracts'
export type * from './contracts'

export const SDK_VERSION = '1.1.0'
import type { Observable, Navigation, ApiClient, Session } from './runtime/types'
export type { Observable, Navigation, ApiClient, Session, SessionSnapshot, Request } from './runtime/types'
export { bindComponent, UpdateProvider } from './web-react'
export type { ClientBindings, Bindings, UseQuery } from './web-react'
export type RouteProps = { params: Record<string, string>; returnTo?: string }
export type RouteEntry = { id: string; path: string; component: ComponentType<RouteProps>; access: 'public' | 'authenticated'; layout?: 'app' | 'standalone' | 'dialog' }
export type NavigationEntry = { id: string; label: LocalizedText; routeId: string; order?: number; placement?: 'main' | 'footer'; icon?: ComponentType<{ className?: string }> }
export type EditorProps = { value: JsonObject; schema: JsonSchema; diagnostics: Diagnostic[]; readOnly: boolean; mode?: 'options' | 'configuration'; onChange(value: JsonObject): void }
export type PanelProps = { task: TaskView; refresh(): void }
export type SettingsSectionProps = { settings: JsonObject; save(patch: JsonObject): Promise<void>; onDirtyChange?(dirty: boolean): void }
export type NodeEditorProps = { node: GraphNode; definition: NodeTypeDefinition; readOnly: boolean; diagnostics: Diagnostic[]; onChange(node: GraphNode): void }
export type NodeDetailProps = { detail: TaskNodeDetail; outputs: JsonObject; draft: JsonObject; readOnly: boolean; onDraftChange(patch: JsonObject): void }
export type SlotMap = {
  root: { id: string; component: ComponentType }
  'shell.routes': RouteEntry
  'shell.navigation': NavigationEntry
  'config.editors': { id: string; component: ComponentType<EditorProps> }
  'task.detail.panels': { id: string; order?: number; component: ComponentType<PanelProps> }
  'task.detail.actions': { id: string; order?: number; component: ComponentType<PanelProps> }
  'settings.sections': { id: string; order?: number; label?: LocalizedText; component: ComponentType<SettingsSectionProps> }
  'workflow.node.editors': { id: string; component: ComponentType<NodeEditorProps> }
  'workflow.node.details': { id: string; component: ComponentType<NodeDetailProps> }
}
export interface Slots extends Observable<number> {
  register<K extends keyof SlotMap>(slot: K, entry: SlotMap[K]): () => void
  list<K extends keyof SlotMap>(slot: K): SlotMap[K][]
}
export interface ClientModules { mountAuthenticated(): Promise<void>; unmountAuthenticated(): Promise<void> }
declare module 'cordis' {
  interface Context { slots: Slots; navigation: Navigation; apiClient: ApiClient; session: Session; clientModules: ClientModules }
}

export { PluginContextProvider, useClient, useObservable, useSlot, usePathname, Link } from './legacy'

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
