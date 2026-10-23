import type { ComponentType } from 'react'
import type { Diagnostic, GraphNode, JsonObject, JsonSchema, LocalizedText, NodeTypeDefinition, TaskNodeDetail, TaskView } from './contracts'
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

export {text,matchRoute} from './domain-helpers'
