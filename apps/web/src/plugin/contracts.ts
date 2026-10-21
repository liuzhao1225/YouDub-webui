export type JsonObject = Record<string, unknown>
export type LocalizedText = string | { default: string; translations?: Record<string, string> }
export type JsonSchema = {
  type?: string | string[]; title?: LocalizedText; description?: LocalizedText; default?: unknown
  properties?: Record<string, JsonSchema>; required?: string[]; enum?: unknown[]
  minimum?: number; maximum?: number; minLength?: number; maxLength?: number
  additionalProperties?: boolean; items?: JsonSchema
  'x-title'?: LocalizedText
  'x-options'?: { value: unknown; label: LocalizedText }[]
  'x-optionsFrom'?: string
  'x-short-title'?: LocalizedText
}
export type InputSlot = { name: string; label: LocalizedText; required: boolean; acceptedMimeTypes: string[]; maxBytes?: number }
export type WorkflowDescription = {
  id: string; version: string; label: LocalizedText; description?: LocalizedText
  inputs: InputSlot[]; configSchema: JsonSchema; defaults?: JsonObject
  ui?: { editor?: string; sourceUrlInput?: string }
}
export type ProviderDescription = {
  id: string; label?: LocalizedText; operations: { id: string }[]; capability?: string; adapter?: string; contractVersion?: string
  execution?: 'local' | 'remote'
  legacy?: boolean
  ready?: boolean; available?: boolean; reason?: string; unavailableReason?: string
  models?: Array<string | { id: string; name?: string; available?: boolean; unavailableReason?: string; maxTokens?: number; devices?: string[]; languages?: string[]; voice_modes?: string[]; voices?: { id: string; label?: LocalizedText; languages?: string[] }[] }>
  configSchema?: JsonSchema; parametersSchema?: JsonSchema
}
export type Catalog = { workflows: WorkflowDescription[]; providers: ProviderDescription[] }
export type TaskStatus = 'queued' | 'running' | 'waiting' | 'paused' | 'cancelling' | 'cancelled' | 'succeeded' | 'failed'
export type TaskAction = 'cancel' | 'retry' | 'rerun' | 'delete'
export type TaskStep = {
  id: string; label: LocalizedText; status: string; progress: number | null
  providerId?: string; message?: string | null; error?: { message: string } | null
}
export type TaskOutput = {
  id: string; name?: string; label: string; mimeType: string; url: string; size?: number
  role?: string; durationMs?: number | null
}
export type TaskView = {
  id: string; attempt: number; status: TaskStatus; sourceName: string
  createdAt: string; updatedAt?: string; workflowId: string; workflowVersion: string
  config: JsonObject; steps: TaskStep[]; outputs: TaskOutput[]; allowedActions: TaskAction[]
  cover?: { url?: string }
  message?: string | null; error?: { code?: string; message: string } | null
  mayStillRun?: boolean
  revision?: number
  graphSnapshot?: WorkflowDocument
  workflowSource?: { documentId: string; documentRevision: number | null; title: string }
  nodeRuntimeInputs?: Record<string, JsonObject>
}
export type TaskSummary = Omit<TaskView, 'config' | 'graphSnapshot' | 'nodeRuntimeInputs'>
export type TaskPage = { items: TaskSummary[]; hasMore: boolean; limit: number; offset: number }
export type ClientModule = {
  id: string; version: string; access: 'public' | 'authenticated'; url: string
  css?: string[]; config?: JsonObject
}
export type ClientManifest = { version: 1; sdkVersion: '1.1.0'; platformVersion: '1'; modules: ClientModule[] }
export type Diagnostic = { field?: string; message: string; code?: string; nodeId?: string; portId?: string; edgeId?: string }
export type Endpoint = { nodeId: string; portId: string }
export type GraphNode = {
  id: string; type: string; typeVersion: string; label?: string
  provider: { id: string; model?: string; device?: string }; config: JsonObject; autoContinue: boolean
}
export type GraphInput = { id: string; label: string; required: boolean; kind: 'artifact'; schemaId: string; acceptedMimeTypes: string[]; maxBytes: number }
export type WorkflowDocument = {
  format: 'youdub.workflow'; formatVersion: 1; id: string; title: string
  nodes: GraphNode[]
  edges: { id: string; source: Endpoint; target: Endpoint }[]
  inputs: GraphInput[]
  outputs: { id: string; label: string; kind: 'artifact'; schemaId: string; required: boolean; source: Endpoint }[]
  presentation: { positions: Record<string, { x: number; y: number }>; viewport: { x: number; y: number; zoom: number } }
}
export type WorkflowDocumentRecord = { id: string; revision: number; document: WorkflowDocument; origin: 'builtin' | 'user' | 'plugin'; createdAt?: string; updatedAt?: string }
export type NodeInputPort = { id: string; label: LocalizedText; kind: 'artifact' | 'json'; acceptedSchemaIds: string[]; required: boolean }
export type NodeOutputPort = { name: string; label?: LocalizedText; kind: 'artifact' | 'json'; schemaId: string; required: boolean }
export type NodeTypeDefinition = {
  type: string; version: string; label: LocalizedText; category: string
  providerId: string; operation: string; provider: ProviderDescription
  inputs: NodeInputPort[]; outputs: NodeOutputPort[]
  runtimeInputSchema?: JsonSchema; configSchema: JsonSchema; defaults: JsonObject
  ui?: { quickFields?: string[]; editorId?: string; detailId?: string }
  corrections?: { outputPorts: string[]; schemaIds: string[] }
}
export type NodeResultRevision = { revision: number; parentRevision?: number | null; source: 'computed' | 'correction'; actionId?: string; outputs: JsonObject; createdAt: string }
export type TaskNodeDetail = {
  taskId: string; nodeId: string; taskRevision: number; attempt: number; status: TaskStatus
  step: TaskStep & { outputs?: JsonObject }; spec: { operation: string; input: JsonObject; outputs: NodeOutputPort[]; autoContinue?: boolean }
  inputs: JsonObject; resultRevisions: NodeResultRevision[]; outputRevision: number; approvedRevision?: number | null
}
