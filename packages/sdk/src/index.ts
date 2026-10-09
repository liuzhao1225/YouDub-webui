import type { Context } from 'cordis'
import type { Readable } from 'node:stream'

export const SDK_VERSION = '1.0.0'
export const WORKER_PROTOCOL = 'youdub-worker/v1'
export type JsonObject = Record<string, any>
export type Disposer = () => void | Promise<void>
export type TaskStatus = 'queued' | 'running' | 'waiting' | 'cancelling' | 'cancelled' | 'succeeded' | 'failed'
export type StepStatus = 'pending' | 'running' | 'waiting' | 'completed' | 'cancelled' | 'failed'
export interface Diagnostic { code: string; message: string; field?: string }
export class AppError extends Error {
  constructor(public code: string, message: string, public status = 400, public details?: unknown) { super(message); this.name = 'AppError' }
}
export interface ArtifactRef { id: string; schemaId: string }
export interface ArtifactDescriptor { path: string; mimeType: string; schemaId: string; metadata?: JsonObject }
export interface Artifact extends ArtifactRef {
  path: string; mimeType: string; name: string; size: number; metadata: JsonObject; invocationId: string
}
export interface InputSlot { name: string; label: string; required: boolean; acceptedMimeTypes: string[]; maxBytes: number }
export type InputRef = { from: 'task'; name: string } | { from: 'step'; stepId: string; output: string }
export interface OutputPort { name: string; kind: 'artifact' | 'json'; schemaId: string; required: boolean; schema?: JsonObject }
export interface ExactProviderBinding {
  pluginId: string; pluginVersion: string; integrity: string; providerId: string;
  model?: string; modelRevision: string | null; device?: string; options: JsonObject
}
export interface StepSpec {
  id: string; label: string; bindingKey: string; operation: string;
  input: Record<string, InputRef | any>; outputs: OutputPort[]
}
export interface WorkflowPlan {
  workflow: { id: string; version: string; pluginId: string; pluginVersion: string; integrity: string };
  config: JsonObject; bindings: Record<string, ExactProviderBinding>; steps: StepSpec[];
  outputs: { id: string; label: string; source: { stepId: string; output: string }; role: string; required: boolean }[];
  omittedSteps?: { id: string; reason: string }[]
}
export interface WorkflowDescription {
  id: string; version: string; label: string; description?: string; inputs: InputSlot[];
  configSchema: JsonObject; defaults: JsonObject; ui?: JsonObject
}
export interface WorkflowDefinition {
  id: string; version: string; pluginId: string; pluginVersion: string; integrity: string;
  describe(): WorkflowDescription;
  validate(input: Record<string, ArtifactRef>, config: JsonObject, catalog: CatalogService): Promise<Diagnostic[]> | Diagnostic[];
  plan(input: Record<string, ArtifactRef>, config: JsonObject, catalog: CatalogService): Promise<WorkflowPlan> | WorkflowPlan
}
export interface ProviderDescription {
  id: string; label: string; pluginId: string; pluginVersion: string; integrity: string;
  operations: { id: string; inputSchema: JsonObject; outputs: OutputPort[] }[];
  configSchema?: JsonObject; capability?: string; adapter?: string; execution?: 'local' | 'remote';
  models?: JsonObject[]; available?: boolean; unavailableReason?: string | null; [key: string]: any
}
export interface ExternalRequest {
  externalRequestId: string; requestKey: string; state: 'pending' | 'succeeded' | 'failed' | 'cancelled' | 'unknown';
  mayStillRun: boolean; operationId?: string; [key: string]: any
}
export interface Invocation {
  invocationId: string; taskId: string; attempt: number; stepId: string; operation: string;
  binding: ExactProviderBinding; inputs: JsonObject; workDir: string; taskDir: string; config: JsonObject
}
export interface InvocationContext {
  signal: AbortSignal;
  progress(value: number | null, message: string): Promise<void>;
  externalPrepare(request: Omit<ExternalRequest, 'state' | 'mayStillRun'>): Promise<void>;
  externalUpdate(request: ExternalRequest): Promise<void>;
  register(descriptor: ArtifactDescriptor): Promise<ArtifactRef>;
  resolve(ref: ArtifactRef): Promise<string>;
  credentials: Record<string, { base_url: string; api_key?: string | null }>
}
export type OperationResult = { state: 'completed'; outputs: JsonObject } | { state: 'waiting'; operation: JsonObject; nextPollAt: string }
export interface OperationProvider {
  id: string; describe(): ProviderDescription; probe(): Promise<JsonObject>;
  execute(request: Invocation, context: InvocationContext): Promise<OperationResult>;
  poll?(operation: JsonObject, context: InvocationContext): Promise<OperationResult>;
}
export interface StepState { id: string; label: string; status: StepStatus; invocationId: string | null; progress: number | null; message: string | null; startedAt: string | null; finishedAt: string | null; outputs: JsonObject; error: Diagnostic | null; operation?: JsonObject }
export interface TaskRecord {
  id: string; revision: number; attempt: number; status: TaskStatus; sourceName: string;
  workflowId: string; workflowVersion: string; config: JsonObject; inputs: Record<string, ArtifactRef>;
  plan: WorkflowPlan; steps: StepState[]; artifacts: Record<string, Artifact>;
  outputs: Array<{ id: string; label: string; role: string; artifact: ArtifactRef }>;
  connections: JsonObject[]; credentialRefs: Record<string, string>; externalRequests: Record<string, ExternalRequest>;
  error: Diagnostic | null; message: string | null; createdAt: string; updatedAt: string; queuedAt: string;
  startedAt: string | null; finishedAt: string | null; nextPollAt: string | null;
  legacy?: boolean; rawSnapshot?: JsonObject; [key: string]: any
}
export interface TaskView extends Omit<TaskRecord, 'artifacts' | 'credentialRefs' | 'rawSnapshot' | 'outputs'> {
  cover?: { url?: string };
  outputs: Array<{ id: string; label: string; role: string; name: string; mimeType: string; size: number }>;
  allowedActions: string[]; mayStillRun: boolean; [key: string]: any
}
export interface CreateTask { id: string; workflowId: string; workflowVersion?: string; config: JsonObject; inputs: Record<string, ArtifactRef>; artifacts?: Record<string, Artifact>; sourceName?: string }
export interface TaskQuery { limit?: number; offset?: number; status?: string; active?: boolean }
export interface TaskPage { items: TaskView[]; limit: number; offset: number; hasMore: boolean }
export interface TasksService {
  assertReady(): void;
  create(request: CreateTask): Promise<TaskView>; get(id: string): Promise<TaskView>; record(id: string): Promise<TaskRecord>;
  list(query?: TaskQuery): Promise<TaskPage>; cancel(id: string, expectedAttempt: number): Promise<TaskView>;
  retry(id: string, expectedAttempt: number): Promise<TaskView>;
  rerun(id: string, request: { id: string; config: JsonObject; workflowId?: string; acknowledgeExternalRisk?: boolean }): Promise<TaskView>;
  delete(id: string, expectedAttempt: number): Promise<void>; idle(): Promise<boolean>
}
export interface CatalogService {
  listProviders(): ProviderDescription[];
  registerProvider(provider: OperationProvider): Disposer; registerWorkflow(workflow: WorkflowDefinition): Disposer;
  provider(id: string): OperationProvider; workflow(id: string): WorkflowDefinition;
  describe(): { providers: ProviderDescription[]; workflows: WorkflowDescription[] };
  refresh(): Promise<void>
}
export interface StoreService { call<T = any>(method: string, params?: JsonObject): Promise<T>; root: string }
export interface SettingsService {
  read(): Promise<any>; patch(patch: JsonObject): Promise<any>; runtime(): Promise<any>;
  locked<T>(action: () => Promise<T>): Promise<T>;
  snapshot(): Promise<{ connections: JsonObject[]; credentialRefs: Record<string, string> }>;
  credentials(task: TaskRecord): Promise<InvocationContext['credentials']>
}
export interface FilesService {
  root: string; taskRoot(id: string): string;
  reserve(id: string, fresh?: boolean): Promise<Disposer>; readLock(id: string): Disposer;
  upload(id: string, slot: string, filename: string, mime: string, input: Readable, maxBytes: number): Promise<Artifact>;
  register(id: string, invocationId: string, workDir: string, descriptor: ArtifactDescriptor): Promise<Artifact>;
  resolve(id: string, artifact: Artifact): Promise<string>; workDir(id: string, attempt: number, invocationId: string): Promise<string>;
  cover(id: string, artifact: Artifact): Promise<{ path: string; mimeType: string }>;
  log(id: string, text: string): Promise<void>; readLog(id: string, lines?: number): Promise<string>;
  remove(id: string): Promise<void>; copyInputs(from: TaskRecord, newId: string): Promise<{ inputs: Record<string, ArtifactRef>; artifacts: Record<string, Artifact> }>
}
export interface ProcessRequest { command: string; args: string[]; cwd?: string; env?: NodeJS.ProcessEnv; signal?: AbortSignal }
export interface ProcessService {
  run(request: ProcessRequest & { input?: string }): Promise<{ stdout: string; stderr: string }>;
  worker(request: ProcessRequest, invocation: Invocation, context: InvocationContext): Promise<OperationResult>;
  rpc(request: ProcessRequest): Promise<{ call<T = any>(method: string, params?: JsonObject): Promise<T>; close(): Promise<void> }>
}
declare module 'cordis' {
  interface Events { 'app/ready'(): void; 'app/stopping'(): void | Promise<void>; 'settings/updated'(settings: JsonObject): void }
  interface Context {
    catalog: CatalogService; tasks: TasksService; store: StoreService; settings: SettingsService;
    files: FilesService; process: ProcessService;
    secrets: { get(reference: string): Promise<string | null>; set(reference: string, value: string): Promise<void>; delete(reference: string): Promise<void> }
  }
}
export type YouDubContext = Context
export function requireId(id: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) throw new AppError('INVALID_CONFIG', 'A canonical UUID is required.', 422)
}
