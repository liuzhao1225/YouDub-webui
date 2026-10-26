import type { ComponentType } from 'react'
import type { Diagnostic, GraphNode, JsonObject, JsonSchema, NodeTypeDefinition, TaskNodeDetail, TaskView } from './contracts'
export type * from './contracts'

import type { Request } from './runtime/types'
import type { QueryResult, WorkflowDocuments } from './runtime/query'
import type { WorkflowResourcesResult } from './runtime/workflow-resources'
import type { StudioDraftStore } from '@/runtime/studio-draft'
import type { WorkflowDocument } from './contracts'
export type { Observable, Request } from './runtime/types'
export type UseQuery = <T>(path: string, pollMs?: number, shouldPoll?: (value: T) => boolean) => QueryResult<T>
export interface ClientBindings {
  request: Request
  navigate(path: string): void
  blockNavigation(handler: (path: string) => Promise<boolean>): () => void
  useQuery: UseQuery
  useWorkflowDocuments(): QueryResult<WorkflowDocuments>
  useSlot<K extends keyof SlotMap>(slot: K): SlotMap[K][]
  useWorkflowResources(document: WorkflowDocument): WorkflowResourcesResult
  draftStore: StudioDraftStore
  submissionStore: StudioDraftStore
}
export type Bindings<K extends keyof ClientBindings> = Pick<ClientBindings, K>
export type RouteProps = { params: Record<string, string> }
export type EditorProps = { value: JsonObject; schema: JsonSchema; diagnostics: Diagnostic[]; readOnly: boolean; mode?: 'options' | 'configuration'; onChange(value: JsonObject): void }
export type PanelProps = { task: TaskView; refresh(): void }
export type NodeEditorProps = { node: GraphNode; definition: NodeTypeDefinition; readOnly: boolean; diagnostics: Diagnostic[]; onChange(node: GraphNode): void }
export type NodeDetailProps = { detail: TaskNodeDetail; outputs: JsonObject; draft: JsonObject; readOnly: boolean; onDraftChange(patch: JsonObject): void }
export type SlotMap = {
  'config.editors': { id: string; component: ComponentType<EditorProps> }
  'task.detail.panels': { id: string; order?: number; component: ComponentType<PanelProps> }
  'task.detail.actions': { id: string; order?: number; component: ComponentType<PanelProps> }
  'workflow.node.editors': { id: string; component: ComponentType<NodeEditorProps> }
  'workflow.node.details': { id: string; component: ComponentType<NodeDetailProps> }
}
export { Link } from '../../../harness/src/frontend/sdk'

export {text,matchRoute} from './domain-helpers'
