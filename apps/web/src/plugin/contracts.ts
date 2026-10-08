export type JsonObject = Record<string, unknown>
export type LocalizedText = string | { default: string; translations?: Record<string, string> }
export type JsonSchema = {
  type?: string; title?: LocalizedText; description?: LocalizedText; default?: unknown
  properties?: Record<string, JsonSchema>; required?: string[]; enum?: unknown[]
  minimum?: number; maximum?: number; minLength?: number; maxLength?: number
  additionalProperties?: boolean; items?: JsonSchema
}
export type InputSlot = { name: string; label: LocalizedText; required: boolean; acceptedMimeTypes: string[]; maxBytes?: number }
export type WorkflowDescription = {
  id: string; version: string; label: LocalizedText; description?: LocalizedText
  inputs: InputSlot[]; configSchema: JsonSchema; defaults?: JsonObject
}
export type ProviderDescription = {
  id: string; label?: LocalizedText; operations: { id: string }[]; capability?: string; adapter?: string; contractVersion?: string
  ready?: boolean; available?: boolean; reason?: string; unavailableReason?: string
  models?: Array<string | { id: string; devices?: string[]; languages?: string[] }>
  configSchema?: JsonSchema; parametersSchema?: JsonSchema
}
export type Catalog = { workflows: WorkflowDescription[]; providers: ProviderDescription[] }
export type TaskStatus = 'queued' | 'running' | 'waiting' | 'cancelling' | 'cancelled' | 'succeeded' | 'failed'
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
  message?: string | null; error?: { code?: string; message: string } | null
  mayStillRun?: boolean
}
export type TaskPage = { items: TaskView[]; hasMore: boolean; limit: number; offset: number }
export type ClientModule = {
  id: string; version: string; access: 'public' | 'authenticated'; url: string
  css?: string[]; config?: JsonObject
}
export type ClientManifest = { version: 1; sdkVersion: '1.0.0'; platformVersion: '1'; modules: ClientModule[] }
export type Diagnostic = { field?: string; message: string }
