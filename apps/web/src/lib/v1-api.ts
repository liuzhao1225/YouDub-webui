import { request } from "@/lib/api"

// Wire types follow backend/app/v1/contracts.py and the checked-in OpenAPI.
export type Stage = "prepare" | "separate" | "asr" | "translate" | "tts" | "mix" | "export"
export type TaskStage = Stage | "done"
export type TaskStatus = "queued" | "running" | "waiting" | "cancelling" | "cancelled" | "succeeded" | "failed"
export type OutputMode = "subtitles" | "dubbing" | "both"
export type UiLanguage = "en" | "zh" | "ja"
export type VoiceMode = "preset" | "source_clone"
export type TaskAction = "cancel" | "retry" | "rerun" | "delete"
export type WaitReason = "active_limit" | "cpu" | "gpu" | "remote_limit" | "remote_result"
export type ErrorAction = "adjust_settings" | "retry" | "rerun" | "contact_support" | "none"
export type ErrorCode =
  | "UNAUTHORIZED" | "CSRF_INVALID" | "ORIGIN_NOT_ALLOWED" | "TASK_NOT_FOUND"
  | "OUTPUT_NOT_FOUND" | "TASK_EXISTS" | "IMPORT_IN_PROGRESS" | "IMPORT_RESIDUE"
  | "TASK_BUSY" | "ATTEMPT_CONFLICT" | "RETRY_NOT_ALLOWED" | "EXTERNAL_RESULT_UNKNOWN"
  | "FILE_TOO_LARGE" | "UNSUPPORTED_MEDIA" | "RANGE_NOT_SATISFIABLE" | "INVALID_CONFIG"
  | "MODEL_NOT_READY" | "UNSUPPORTED_LANGUAGE" | "INVALID_PROVIDER_RESULT" | "INTERNAL_ERROR"
  | "FILE_DELETE_FAILED" | "SETTINGS_PARTIALLY_APPLIED" | "RUNTIME_UNAVAILABLE" | "DISK_FULL"
  | "APP_INTERRUPTED" | "WORKER_EXITED" | "REMOTE_QUERY_FAILED" | "REMOTE_TIMEOUT"
  | "PROVIDER_REJECTED" | "CANCEL_TIMEOUT" | "NO_AUDIO_TRACK" | "INVALID_MEDIA"
  | "INPUT_MISSING" | "STAGE_OUTPUT_MISSING" | "UNSUPPORTED_OVERLAPPING_SPEECH"
  | "AUDIO_EXCEEDS_VIDEO"

export type TaskError = {
  code: ErrorCode
  message: string
  field: string | null
  stage: Stage | null
  action: ErrorAction
}

export type ModelSelection = {
  adapter: string
  model: string
  device: "cpu" | `cuda:${number}` | "remote"
}

export type AsrSelection = ModelSelection & { initial_prompt?: string | null }
export type VoiceSelection = { mode: "preset"; id: string } | { mode: "source_clone" }
export type TtsSelection = ModelSelection & { voice: VoiceSelection }

export type TaskConfig = {
  source_language: string
  target_language: string
  output_mode: OutputMode
  keep_background: boolean
  asr: AsrSelection
  translation: ModelSelection
  tts: TtsSelection | null
  separation: ModelSelection | null
}

export type ResolvedConnection = { adapter: string; base_url: string }
export type ConnectionRead = ResolvedConnection & { has_api_key: boolean }
export type Settings = {
  defaults: TaskConfig | null
  connections: ConnectionRead[]
  ui_language: UiLanguage
}

export type ConnectionPatch = { adapter: string } & (
  | { base_url: string; api_key?: string | null }
  | { base_url?: string; api_key: string | null }
)

// Each PATCH updates one settings group. Omit api_key to retain it; null clears it.
export type SettingsPatch =
  | { defaults: TaskConfig; ui_language?: never; connection?: never }
  | { defaults?: never; ui_language: UiLanguage; connection?: never }
  | { defaults?: never; ui_language?: never; connection: ConnectionPatch }

export type Device = {
  id: "cpu" | `cuda:${number}`
  name: string
  available: boolean
  unavailable_reason: string | null
}

export type Voice = { id: string; name: string; languages: string[] }
export type ModelInputLimits = {
  max_audio_duration_ms: number | null
  max_text_chars: number | null
  max_reference_duration_ms: number | null
}
export type ModelCapability = {
  id: string
  devices: string[]
  source_languages: string[]
  target_languages: string[]
  voice_modes: VoiceMode[]
  voices: Voice[]
  input_limits: ModelInputLimits
}
export type RemoteOperations = {
  submit_mode: "sync" | "async"
  can_poll: boolean
  can_cancel: boolean
  can_lookup_request_key: boolean
}
export type Capability = {
  adapter: string
  capability: "separation" | "asr" | "translation" | "tts"
  execution: "local" | "remote"
  available: boolean
  unavailable_reason: string | null
  requires_api_key: boolean
  models: ModelCapability[]
  data_sent: ("audio" | "text" | "reference_audio")[]
  remote_operations: RemoteOperations | null
}
export type RuntimeLimits = {
  max_file_bytes: number
  max_video_duration_ms: number
  max_video_width: number
  max_video_height: number
  max_frame_rate: number
  video_suffixes: string[]
  video_codecs: string[]
  audio_codecs: string[]
  max_active_tasks: number
  cpu_heavy_slots: number
  gpu_slots_per_device: number
  remote_request_slots_per_connection: number
  remote_pending_slots_per_connection: number
  poll_interval_ms: number
}
export type Runtime = {
  api_version: "v1"
  contract_version: string
  instance_id: string
  status: "ready" | "degraded"
  platform: "windows" | "macos" | "linux"
  arch: string
  devices: Device[]
  capabilities: Capability[]
  limits: RuntimeLimits
}

export type OutputKind = "video" | "audio" | "source_subtitles" | "translated_subtitles"
export type OutputFile = {
  url: string
  file_name: string
  mime_type: "video/mp4" | "audio/wav" | "application/x-subrip"
  size_bytes: number
  duration_ms: number | null
  timeline: "source" | "dubbed" | null
}
export type Outputs = Partial<Record<OutputKind, OutputFile>>
export type ExternalOperation = {
  state: "none" | "pending" | "succeeded" | "failed" | "cancelled" | "unknown"
  may_still_run: boolean
}
export type TaskSummary = {
  id: string
  attempt: number
  source_name: string
  source_size_bytes: number
  source_duration_ms: number | null
  status: TaskStatus
  current_stage: TaskStage
  stage_progress: number | null
  wait_reason: WaitReason | null
  message: string | null
  error: TaskError | null
  external_operation: ExternalOperation
  allowed_actions: TaskAction[]
  created_at: string
  updated_at: string
  started_at: string | null
  finished_at: string | null
}
export type Task = TaskSummary & {
  config: TaskConfig
  pipeline_version: string
  resolved_connections: ResolvedConnection[]
  outputs: Outputs
}
export type TaskList = { items: TaskSummary[]; limit: number; offset: number; has_more: boolean }
export type TaskListParams = { limit?: number; offset?: number } & (
  | { status?: TaskStatus; active?: never }
  | { status?: never; active?: boolean }
)
export type RetryRequest = { expected_attempt: number }
export type RerunRequest = { id: string; config: TaskConfig; acknowledge_external_risk?: boolean }
export type TaskLogParams = { lines?: number; download?: boolean }

const BASE_PATH = "/api/v1"

function taskPath(id: string) {
  return `${BASE_PATH}/tasks/${encodeURIComponent(id)}`
}

function queryString(params: Record<string, string | number | boolean | undefined>) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value))
  }
  const query = search.toString()
  return query ? `?${query}` : ""
}

export function getRuntime(signal?: AbortSignal) {
  return request<Runtime>(`${BASE_PATH}/runtime`, { signal })
}

export function getSettings(signal?: AbortSignal) {
  return request<Settings>(`${BASE_PATH}/settings`, { signal })
}

export function patchSettings(patch: SettingsPatch) {
  return request<Settings>(`${BASE_PATH}/settings`, { method: "PATCH", body: JSON.stringify(patch) })
}

// The caller retains this id to query an upload whose response was interrupted.
export function createTask(file: File, config: TaskConfig, id: string, signal?: AbortSignal) {
  const body = new FormData()
  body.append("id", id)
  body.append("file", file)
  body.append("config", new Blob([JSON.stringify(config)], { type: "application/json" }), "config.json")
  return request<Task>(`${BASE_PATH}/tasks`, { method: "POST", body, signal })
}

export function listTasks(params: TaskListParams = {}, signal?: AbortSignal) {
  return request<TaskList>(`${BASE_PATH}/tasks${queryString(params)}`, { signal })
}

export function getTask(id: string, signal?: AbortSignal) {
  return request<Task>(taskPath(id), { signal })
}

export function cancelTask(id: string) {
  return request<Task>(`${taskPath(id)}/cancel`, { method: "POST" })
}

export function retryTask(id: string, expectedAttempt: number) {
  const body: RetryRequest = { expected_attempt: expectedAttempt }
  return request<Task>(`${taskPath(id)}/retry`, { method: "POST", body: JSON.stringify(body) })
}

export function rerunTask(id: string, body: RerunRequest) {
  return request<Task>(`${taskPath(id)}/rerun`, { method: "POST", body: JSON.stringify(body) })
}

export function deleteTask(id: string) {
  return request<void>(taskPath(id), { method: "DELETE" })
}

export function getTaskFileUrl(id: string, kind: OutputKind) {
  return `${taskPath(id)}/files/${kind}`
}

export function getTaskLogUrl(id: string, params: TaskLogParams = {}) {
  return `${taskPath(id)}/log${queryString(params)}`
}

export function getTaskLog(id: string, params: TaskLogParams = {}, signal?: AbortSignal) {
  return request<string>(getTaskLogUrl(id, params), { signal }, { responseType: "text" })
}
