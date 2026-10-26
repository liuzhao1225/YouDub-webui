import type { Context } from 'cordis'
import type { Readable } from 'node:stream'

export const SDK_VERSION = '1.1.0'
export const WORKER_PROTOCOL = 'youdub-worker/v1'
export type JsonObject = Record<string, any>
export type Disposer = () => void | Promise<void>
export type TaskStatus = 'queued' | 'running' | 'waiting' | 'paused' | 'cancelling' | 'cancelled' | 'succeeded' | 'failed'
export type StepStatus = 'pending' | 'running' | 'waiting' | 'awaiting_review' | 'completed' | 'cancelled' | 'failed'
export interface Diagnostic { code: string; message: string; field?: string; nodeId?: string; portId?: string; edgeId?: string; stage?: string; action?: string; status?: number; details?: unknown }
export class AppError extends Error {
  constructor(public code: string, message: string, public status = 400, public details?: unknown) { super(message); this.name = 'AppError' }
}
export interface ArtifactRef { id: string; schemaId: string }
export interface ArtifactDescriptor { path: string; mimeType: string; schemaId: string; metadata?: JsonObject }
export interface Artifact extends ArtifactRef {
  path: string; mimeType: string; name: string; size: number; metadata: JsonObject; invocationId: string
}
export interface InputSlot { name: string; label: string; required: boolean; acceptedMimeTypes: string[]; maxBytes?: number }
export type InputRef = { from: 'task'; name: string } | { from: 'step'; stepId: string; output: string }
export interface OutputPort { label?: LocalizedText; name: string; kind: 'artifact' | 'json'; schemaId: string; required: boolean; schema?: JsonObject }
export interface ExactProviderBinding {
  pluginId: string; pluginVersion: string; integrity: string; providerId: string;
  model?: string; modelRevision: string | null; device?: string; options: JsonObject
}
export interface StepSpec {
  id: string; label: string; bindingKey: string; operation: string;
  input: Record<string, InputRef | any>; outputs: OutputPort[]; autoContinue?: boolean
}
export interface WorkflowPlan {
  workflow: { id: string; version: string; pluginId: string; pluginVersion: string; integrity: string };
  config: JsonObject; bindings: Record<string, ExactProviderBinding>; steps: StepSpec[];
  outputs: { id: string; label: string; source: { stepId: string; output: string }; role: string; required: boolean }[];
  omittedSteps?: { id: string; reason: string }[]
}
export interface WorkflowDescription {
  id: string; version: string; label: string; description?: string; inputs: InputSlot[];
  configSchema: JsonObject; defaults: JsonObject; ui?: JsonObject; graphTemplate?: WorkflowDocument
}
export interface WorkflowDefinition {
  id: string; version: string; pluginId: string; pluginVersion: string; integrity: string; compatibleIntegrities?: string[];
  describe(): WorkflowDescription;
  validate(input: Record<string, ArtifactRef>, config: JsonObject, catalog: CatalogService): Promise<Diagnostic[]> | Diagnostic[];
  plan(input: Record<string, ArtifactRef>, config: JsonObject, catalog: CatalogService): Promise<WorkflowPlan> | WorkflowPlan
}
export type LocalizedText = string | { default: string; translations?: Record<string, string> }
export interface InputPortDefinition { id: string; label: LocalizedText; kind: 'artifact' | 'json'; acceptedSchemaIds: string[]; required: boolean }
export interface NodeDescriptor {
  type: string; version: string; label: LocalizedText; category: string; inputs: InputPortDefinition[];
  runtimeInputSchema?: JsonObject; configSchema: JsonObject; defaults: JsonObject;
  ui?: { quickFields?: string[]; editorId?: string; detailId?: string };
  corrections?: { outputPorts: string[]; schemaIds: string[] }
}
export interface GraphEndpoint { nodeId: string; portId: string }
export interface GraphNode { id: string; type: string; typeVersion: string; label?: string; provider: { id: string; model?: string; device?: string }; config: JsonObject; autoContinue: boolean }
export interface WorkflowDocument {
  format: 'youdub.workflow'; formatVersion: 1; id: string; title: string;
  nodes: GraphNode[]; edges: { id: string; source: GraphEndpoint; target: GraphEndpoint }[];
  inputs: { id: string; label: string; required: boolean; kind: 'artifact'; schemaId: string; acceptedMimeTypes: string[]; maxBytes?: number }[];
  outputs: { id: string; label: string; kind: 'artifact'; schemaId: string; required: boolean; source: GraphEndpoint }[];
  presentation: { positions: Record<string, { x: number; y: number }>; viewport: { x: number; y: number; zoom: number } }
}
export interface GraphCompileRequest { document: WorkflowDocument; inputs: Record<string, ArtifactRef>; nodeRuntimeInputs: Record<string, JsonObject> }
export type GraphWorkflowDefinition = Omit<WorkflowDefinition, 'validate' | 'plan'> & {
  graph: { compile(request: GraphCompileRequest, catalog: CatalogService): Promise<{ plan: WorkflowPlan; graphSnapshot: WorkflowDocument }> }
}
export type RegisteredWorkflow = WorkflowDefinition | GraphWorkflowDefinition
export interface NodeTypeDefinition extends NodeDescriptor { providerId: string; operation: string; outputs: OutputPort[]; provider: ProviderDescription }
export interface NodeResultRevision { revision: number; parentRevision: number | null; source: 'computed' | 'correction'; actionId: string | null; outputs: JsonObject; createdAt: string }
export interface ReviewCommand { actionId: string; expectedAttempt: number; expectedTaskRevision: number; expectedOutputRevision: number }
export interface NodeActionReceipt { actionId: string; kind: string; nodeId: string; attempt: number; taskRevision: number; outputRevision: number; status: TaskStatus; createdAt: string }
export interface NodeResultView { taskId: string; nodeId: string; taskRevision: number; attempt: number; status: TaskStatus; step: StepState; spec: StepSpec; inputs: JsonObject; resultRevisions: NodeResultRevision[]; outputRevision: number; approvedRevision: number | null }
export interface RerunTask {
  id: string; config: JsonObject; workflowId?: string; fromStep?: string; acknowledgeExternalRisk?: boolean;
  graphDocument?: WorkflowDocument; nodeRuntimeInputs?: Record<string, JsonObject>; expectedAttempt?: number; expectedTaskRevision?: number;
  sourceRevisions?: Record<string, number>; corrections?: Record<string, { revision: number; patch: JsonObject }>
}
export interface ProviderDescription {
  id: string; label: string; pluginId: string; pluginVersion: string; integrity: string; compatibleIntegrities?: string[];
  resources?: { dependencyGroups: string[]; model?: { id: string; downloadId: string } };
  operations: { id: string; inputSchema: JsonObject; outputs: OutputPort[]; node?: NodeDescriptor }[];
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
  log?(message: string): Promise<void>;
  externalPrepare(request: Omit<ExternalRequest, 'state' | 'mayStillRun'>): Promise<void>;
  externalUpdate(request: ExternalRequest): Promise<void>;
  register(descriptor: ArtifactDescriptor): Promise<ArtifactRef>;
  resolve(ref: ArtifactRef): Promise<string>;
  credentials: Record<string, { base_url: string; api_key?: string | null; profile?: JsonObject }>
}
export type OperationResult = { state: 'completed'; outputs: JsonObject } | { state: 'waiting'; operation: JsonObject; nextPollAt: string }
export interface OperationProvider {
  id: string; describe(): ProviderDescription; probe(): Promise<JsonObject>;
  execute(request: Invocation, context: InvocationContext): Promise<OperationResult>;
  poll?(operation: JsonObject, context: InvocationContext): Promise<OperationResult>;
  validateCorrection?(request: { operation: string; inputs: JsonObject; baselineOutputs: JsonObject; patch: JsonObject }): Promise<JsonObject> | JsonObject;
}
export interface StepState { id: string; label: LocalizedText; status: StepStatus; invocationId: string | null; progress: number | null; message: string | null; startedAt: string | null; finishedAt: string | null; outputs: JsonObject; error: Diagnostic | null; operation?: JsonObject; resultRevisions?: NodeResultRevision[]; outputRevision?: number; approvedRevision?: number | null; approvalActionId?: string | null }
export interface TaskRecord {
  id: string; revision: number; attempt: number; status: TaskStatus; sourceName: string;
  workflowId: string; workflowVersion: string; config: JsonObject; inputs: Record<string, ArtifactRef>;
  plan: WorkflowPlan; steps: StepState[]; artifacts: Record<string, Artifact>;
  outputs: Array<{ id: string; label: string; role: string; artifact: ArtifactRef }>;
  connections: JsonObject[]; credentialRefs: Record<string, string>; externalRequests: Record<string, ExternalRequest>;
  error: Diagnostic | null; message: string | null; createdAt: string; updatedAt: string; queuedAt: string;
  startedAt: string | null; finishedAt: string | null; nextPollAt: string | null;
  reusedFrom?: { taskId: string; attempt: number; fromStep: string; workflow: WorkflowPlan['workflow']; bindings: WorkflowPlan['bindings'] };
  graphSnapshot?: WorkflowDocument; workflowSource?: { documentId: string; documentRevision: number | null; title: string }; nodeRuntimeInputs?: Record<string, JsonObject>;
  legacy?: boolean; rawSnapshot?: JsonObject; [key: string]: any
}
export interface TaskView extends Omit<TaskRecord, 'artifacts' | 'credentialRefs' | 'rawSnapshot' | 'outputs'> {
  steps: StepState[];
  cover?: { artifactId?: string; url?: string };
  outputs: Array<{ id: string; label: string; role: string; name: string; mimeType: string; size: number }>;
  allowedActions: string[]; mayStillRun: boolean; [key: string]: any
}
export type TaskSummary = Pick<TaskRecord,
  'id' | 'revision' | 'attempt' | 'status' | 'sourceName' | 'workflowId' | 'workflowVersion' | 'workflowSource' |
  'error' | 'message' | 'createdAt' | 'updatedAt' | 'queuedAt' | 'startedAt' | 'finishedAt' | 'nextPollAt' |
  'legacy'> & Pick<TaskView, 'cover' | 'outputs' | 'allowedActions' | 'mayStillRun'> & {
  steps: Pick<StepState, 'id' | 'label' | 'status' | 'progress' | 'message' | 'startedAt' | 'finishedAt' | 'error'>[]
}
export interface CreateTask { id: string; workflowId: string; workflowVersion?: string; config: JsonObject; inputs: Record<string, ArtifactRef>; artifacts?: Record<string, Artifact>; sourceName?: string; graphDocument?: WorkflowDocument; documentRevision?: number | null; nodeRuntimeInputs?: Record<string, JsonObject> }
export interface TaskQuery { limit?: number; offset?: number; status?: string; active?: boolean }
export interface TaskPage { items: TaskSummary[]; limit: number; offset: number; hasMore: boolean }
export interface TasksService {
  assertReady(): void;
  create(request: CreateTask): Promise<TaskView>; get(id: string): Promise<TaskView>; record(id: string): Promise<TaskRecord>;
  list(query?: TaskQuery): Promise<TaskPage>; cancel(id: string, expectedAttempt: number, expectedTaskRevision?: number): Promise<TaskView>;
  retry(id: string, expectedAttempt: number): Promise<TaskView>;
  rerun(id: string, request: RerunTask): Promise<TaskView>;
  rerunPreview(id: string, request: RerunTask): Promise<JsonObject>;
  node(id: string, nodeId: string, revision?: number): Promise<NodeResultView>;
  approve(id: string, nodeId: string, request: ReviewCommand): Promise<NodeActionReceipt>;
  correct(id: string, nodeId: string, request: ReviewCommand & { patch: JsonObject; continue?: boolean }): Promise<NodeActionReceipt>;
  action(id: string, actionId: string): Promise<NodeActionReceipt | null>;
  delete(id: string, expectedAttempt: number): Promise<void>; idle(): Promise<boolean>
}
export type OutputValidator = (value: any, context: { inputs: JsonObject; outputs: JsonObject }) => void
export interface CatalogService {
  listProviders(): ProviderDescription[];
  registerProvider(provider: OperationProvider): Disposer; registerWorkflow(workflow: RegisteredWorkflow): Disposer;
  provider(id: string): OperationProvider; workflow(id: string): RegisteredWorkflow;
  registerOutputValidator(schemaId: string, validator: OutputValidator): Disposer;
  validateOutput(schemaId: string, value: unknown, context: { inputs: JsonObject; outputs: JsonObject }): void;
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
  upload(id: string, slot: string, filename: string, mime: string, input: Readable, maxBytes?: number): Promise<Artifact>;
  register(id: string, invocationId: string, workDir: string, descriptor: ArtifactDescriptor): Promise<Artifact>;
  resolve(id: string, artifact: Artifact): Promise<string>; workDir(id: string, attempt: number, invocationId: string): Promise<string>;
  cover(id: string, artifact: Artifact): Promise<{ path: string; mimeType: string }>;
  log(id: string, text: string): Promise<void>; readLog(id: string, lines?: number): Promise<string>;
  remove(id: string): Promise<void>; copyInputs(from: TaskRecord, newId: string): Promise<{ inputs: Record<string, ArtifactRef>; artifacts: Record<string, Artifact> }>
  copyArtifacts(from: TaskRecord, newId: string, references: ArtifactRef[]): Promise<Record<string, Artifact>>;
}
export interface ProcessRequest { command: string; args: string[]; cwd?: string; env?: NodeJS.ProcessEnv; signal?: AbortSignal }
export interface ProcessService {
  run(request: ProcessRequest & { input?: string; onOutput?: (text: string, stream: 'stdout' | 'stderr') => void }): Promise<{ stdout: string; stderr: string }>;
  worker(request: ProcessRequest, invocation: Invocation, context: InvocationContext): Promise<OperationResult>;
  rpc(request: ProcessRequest): Promise<{ call<T = any>(method: string, params?: JsonObject): Promise<T>; close(): Promise<void> }>
}
declare module 'cordis' {
  interface Events { 'app/ready'(): void; 'app/stopping'(): void | Promise<void>; 'settings/updated'(settings: JsonObject): void }
  interface Context {
    catalog: CatalogService; tasks: TasksService; store: StoreService; settings: SettingsService;
    files: FilesService; youdubWorker: ProcessService;
  }
}
export type YouDubContext = Context
export function requireId(id: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) throw new AppError('INVALID_CONFIG', 'A canonical UUID is required.', 422)
}
