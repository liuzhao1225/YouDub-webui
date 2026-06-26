function configuredApiBase(): string {
  const configured = process.env.NEXT_PUBLIC_API_BASE_URL?.trim()
  if (configured) return configured.replace(/\/$/, "")

  if (typeof window === "undefined") return "http://127.0.0.1:8000"
  return ""
}

export const API_BASE = configuredApiBase()

export type StageStatus = "pending" | "running" | "succeeded" | "failed"
export type TaskStatus = "queued" | "running" | "paused" | "succeeded" | "failed"
export type ExecutionMode = "auto" | "manual"

export type TaskStage = {
  task_id: string
  name: string
  label: string
  status: StageStatus
  progress: number | null
  started_at: string | null
  completed_at: string | null
  last_message: string | null
  error_message: string | null
}

export type Task = {
  id: string
  url: string
  title: string | null
  status: TaskStatus
  current_stage: string | null
  session_path: string | null
  final_video_path: string | null
  error_message: string | null
  created_at: string
  started_at: string | null
  completed_at: string | null
  execution_mode: ExecutionMode
  stages: TaskStage[]
}

export type CookieInfo = {
  exists: boolean
  size: number
  updated_at: number | null
  content: string
}

export type OpenAISettings = {
  base_url: string
  api_key: string
  has_api_key: boolean
  model: string
  translate_concurrency: string
}

export type OpenAIModels = {
  models: string[]
}

export type YtdlpSettings = {
  proxy_port: string
}

export type LocalDirection = "en-zh" | "zh-en"

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers || {}),
    },
    cache: "no-store",
  })
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(body.detail || `Request failed: ${response.status}`)
  }
  if (response.status === 204) {
    return undefined as T
  }
  return response.json()
}

export type TaskSummary = {
  id: string
  url: string
  title: string | null
  status: TaskStatus
  current_stage: string | null
  final_video_path: string | null
  error_message: string | null
  created_at: string
  started_at: string | null
  completed_at: string | null
  execution_mode?: ExecutionMode
}

export type TaskListStatus = "all" | TaskStatus
export type TaskListExecutionMode = "all" | ExecutionMode
export type TaskListSort =
  | "created_desc"
  | "created_asc"
  | "started_desc"
  | "started_asc"
  | "completed_desc"
  | "completed_asc"
  | "status_asc"
  | "status_desc"
  | "title_asc"
  | "title_desc"

export type TaskListParams = {
  page?: number
  page_size?: number
  q?: string
  status?: TaskListStatus
  execution_mode?: TaskListExecutionMode
  sort?: TaskListSort
}

export type TaskListResponse = {
  tasks: TaskSummary[]
  total: number
  page: number
  page_size: number
}

export function getCurrentTask() {
  return request<Task | null>("/api/tasks/current")
}

export async function getTaskLog(taskId: string): Promise<string> {
  const response = await fetch(`${API_BASE}/api/tasks/${taskId}/log`, { cache: "no-store" })
  if (!response.ok) {
    throw new Error(`Failed to load log: ${response.status}`)
  }
  return response.text()
}

export function listTasks(params: TaskListParams | number = {}) {
  const normalized = typeof params === "number" ? { page_size: params } : params
  const search = new URLSearchParams()

  Object.entries(normalized).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return
    search.set(key, String(value))
  })

  const query = search.toString()
  return request<TaskListResponse>(`/api/tasks${query ? `?${query}` : ""}`)
}

export function getTask(taskId: string) {
  return request<Task>(`/api/tasks/${taskId}`)
}

export function deleteTask(taskId: string) {
  return request<void>(`/api/tasks/${taskId}`, { method: "DELETE" })
}

export function rerunTask(taskId: string) {
  return request<Task>(`/api/tasks/${taskId}/rerun`, { method: "POST" })
}

export function resumeTask(taskId: string) {
  return request<Task>(`/api/tasks/${taskId}/resume`, { method: "POST" })
}

export function continueTask(taskId: string, executionMode?: ExecutionMode) {
  return request<Task>(`/api/tasks/${taskId}/continue`, {
    method: "POST",
    body: JSON.stringify(executionMode ? { execution_mode: executionMode } : {}),
  })
}

export function redoStage(taskId: string, stageName: string) {
  return request<Task>(`/api/tasks/${taskId}/stages/${stageName}/redo`, { method: "POST" })
}

export function createTask(url: string, executionMode: ExecutionMode = "auto") {
  return request<Task>("/api/tasks", {
    method: "POST",
    body: JSON.stringify({ url, execution_mode: executionMode }),
  })
}

export async function uploadLocalTask(
  file: File,
  direction: LocalDirection,
  subtitleFile: File | null = null,
  executionMode: ExecutionMode = "auto",
) {
  const form = new FormData()
  form.append("direction", direction)
  form.append("file", file)
  if (subtitleFile) {
    form.append("subtitle_file", subtitleFile)
  }
  form.append("execution_mode", executionMode)

  const response = await fetch(`${API_BASE}/api/tasks/upload`, {
    method: "POST",
    body: form,
    cache: "no-store",
  })
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(body.detail || `Request failed: ${response.status}`)
  }
  return response.json() as Promise<Task>
}

export function getCookieInfo() {
  return request<CookieInfo>("/api/cookies/youtube")
}

export function saveCookie(content: string) {
  return request<CookieInfo>("/api/cookies/youtube", {
    method: "POST",
    body: JSON.stringify({ content }),
  })
}

export function getOpenAISettings() {
  return request<OpenAISettings>("/api/settings/openai")
}

export function saveOpenAISettings(settings: {
  base_url: string
  api_key: string
  clear_api_key?: boolean
  model: string
  translate_concurrency: string
}) {
  return request<OpenAISettings>("/api/settings/openai", {
    method: "POST",
    body: JSON.stringify(settings),
  })
}

export function getOpenAIModels(settings: {
  base_url: string
  api_key: string
}) {
  return request<OpenAIModels>("/api/settings/openai/models", {
    method: "POST",
    body: JSON.stringify(settings),
  })
}

export function getYtdlpSettings() {
  return request<YtdlpSettings>("/api/settings/ytdlp")
}

export function saveYtdlpSettings(settings: YtdlpSettings) {
  return request<YtdlpSettings>("/api/settings/ytdlp", {
    method: "POST",
    body: JSON.stringify(settings),
  })
}

export function finalVideoUrl(taskId: string) {
  return `${API_BASE}/api/tasks/${taskId}/artifact/final-video`
}

export function finalVideoDownloadUrl(taskId: string) {
  return `${API_BASE}/api/tasks/${taskId}/artifact/final-video?download=1`
}
