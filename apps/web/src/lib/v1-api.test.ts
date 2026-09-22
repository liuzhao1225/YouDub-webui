import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { TaskConfig } from "@/lib/v1-api"

let api: typeof import("@/lib/api")
let v1: typeof import("@/lib/v1-api")
const fetchMock = vi.fn<typeof fetch>()
const taskId = "8d129c98-8e49-4afb-af3a-0b4da4a5533f"
const config: TaskConfig = {
  source_language: "en",
  target_language: "zh",
  output_mode: "subtitles",
  keep_background: false,
  asr: { adapter: "test_asr", model: "asr", device: "remote" },
  translation: { adapter: "test_translation", model: "translation", device: "remote" },
  tts: null,
  separation: null,
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

function readBlob(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsText(blob)
  })
}

async function restoreSession() {
  fetchMock.mockResolvedValueOnce(jsonResponse({
    authenticated: true,
    csrf_token: "shared-csrf-token",
    expires_at: "2026-09-22T10:00:00.000Z",
  }))
  await api.getAuthSession()
}

beforeEach(async () => {
  vi.resetModules()
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
  api = await import("@/lib/api")
  v1 = await import("@/lib/v1-api")
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("v1 API 客户端", () => {
  it("复用登录会话和 CSRF，以 multipart 原样上传调用方 id 与 JSON 配置", async () => {
    await restoreSession()
    const file = new File(["video"], "示例.mp4", { type: "video/mp4" })
    const signal = new AbortController().signal
    fetchMock.mockResolvedValue(jsonResponse({ id: taskId }, 201))

    await expect(v1.createTask(file, config, taskId, signal)).resolves.toEqual({ id: taskId })
    const [path, init] = fetchMock.mock.calls.at(-1)!
    expect(path).toBe("/api/v1/tasks")
    expect(init).toMatchObject({ method: "POST", credentials: "include", cache: "no-store", signal })
    const headers = new Headers(init?.headers)
    expect(headers.get("X-CSRF-Token")).toBe("shared-csrf-token")
    expect(headers.has("Content-Type")).toBe(false)
    const form = init?.body as FormData
    expect(Array.from(form.keys())).toEqual(["id", "file", "config"])
    expect(form.get("id")).toBe(taskId)
    expect(form.get("file")).toBe(file)
    const configFile = form.get("config") as File
    expect(configFile.name).toBe("config.json")
    expect(configFile.type).toBe("application/json")
    expect(JSON.parse(await readBlob(configFile))).toEqual(config)

    // A caller retry keeps its original id; the client never manufactures a new task.
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: taskId }, 201))
    await v1.createTask(file, config, taskId)
    expect((fetchMock.mock.calls.at(-1)![1]?.body as FormData).get("id")).toBe(taskId)
  })

  it("上传响应丢失时直接返回原始失败，仍可用相同 id 查询", async () => {
    const failure = new TypeError("Network request failed")
    fetchMock.mockRejectedValueOnce(failure)
    await expect(v1.createTask(new File(["video"], "sample.mp4"), config, taskId)).rejects.toBe(failure)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: taskId }))
    await expect(v1.getTask(taskId)).resolves.toEqual({ id: taskId })
    expect(fetchMock.mock.calls.at(-1)![0]).toBe(`/api/v1/tasks/${taskId}`)
  })

  it("读取 runtime/settings 共用请求选项并传递终止信号", async () => {
    const signal = new AbortController().signal
    const runtime = { api_version: "v1", capabilities: [] }
    const settings = { defaults: null, connections: [], ui_language: "zh" }
    fetchMock.mockResolvedValueOnce(jsonResponse(runtime)).mockResolvedValueOnce(jsonResponse(settings))
    await expect(v1.getRuntime(signal)).resolves.toEqual(runtime)
    await expect(v1.getSettings(signal)).resolves.toEqual(settings)
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual(["/api/v1/runtime", "/api/v1/settings"])
    for (const [, init] of fetchMock.mock.calls) {
      expect(init).toMatchObject({ credentials: "include", cache: "no-store", signal })
      expect(new Headers(init?.headers).has("X-CSRF-Token")).toBe(false)
    }
  })

  it("列表只发送 v1 参数，保留 false 和 offset=0", async () => {
    const result = { items: [], limit: 5, offset: 0, has_more: false }
    const signal = new AbortController().signal
    fetchMock.mockImplementation(async () => jsonResponse(result))
    await expect(v1.listTasks({ active: false, limit: 5, offset: 0 }, signal)).resolves.toEqual(result)
    expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/tasks?active=false&limit=5&offset=0")
    expect(fetchMock.mock.calls[0][1]?.signal).toBe(signal)
    await v1.listTasks({ status: "waiting", limit: undefined })
    expect(fetchMock.mock.calls[1][0]).toBe("/api/v1/tasks?status=waiting")
    await v1.listTasks()
    expect(fetchMock.mock.calls[2][0]).toBe("/api/v1/tasks")
  })

  it("设置 PATCH 保留清除密钥的 null，并共享 CSRF", async () => {
    await restoreSession()
    fetchMock.mockImplementation(async () => jsonResponse({ defaults: null, connections: [], ui_language: "zh" }))
    const patch = { connection: { adapter: "test_translation", api_key: null } }
    await v1.patchSettings(patch)
    const [path, init] = fetchMock.mock.calls.at(-1)!
    expect(path).toBe("/api/v1/settings")
    expect(init?.method).toBe("PATCH")
    expect(JSON.parse(String(init?.body))).toEqual(patch)
    expect(new Headers(init?.headers).get("Content-Type")).toBe("application/json")
    expect(new Headers(init?.headers).get("X-CSRF-Token")).toBe("shared-csrf-token")

    await v1.patchSettings({ connection: { adapter: "test_translation", base_url: "https://example.com/v1" } })
    expect(JSON.parse(String(fetchMock.mock.calls.at(-1)![1]?.body)).connection).not.toHaveProperty("api_key")
  })

  it("保留 v1 结构化错误的状态码、错误码、字段、阶段与建议操作", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: {
      code: "INVALID_CONFIG",
      message: "目标语言不可用",
      field: "config.target_language",
      stage: "translate",
      action: "adjust_settings",
    } }, 422))
    const error = await v1.patchSettings({ defaults: config }).catch((failure: unknown) => failure)
    expect(error).toBeInstanceOf(api.ApiError)
    expect(error).toMatchObject({
      status: 422,
      code: "INVALID_CONFIG",
      message: "目标语言不可用",
      field: "config.target_language",
      stage: "translate",
      action: "adjust_settings",
    })
  })

  it("v1 返回 401 时发出既有登录事件并清空共享 CSRF", async () => {
    await restoreSession()
    const unauthorized = vi.fn()
    window.addEventListener(api.AUTH_UNAUTHORIZED_EVENT, unauthorized)
    try {
      fetchMock.mockResolvedValueOnce(jsonResponse({ error: {
        code: "UNAUTHORIZED", message: "请重新登录", field: null, stage: null, action: "none",
      } }, 401))
      await expect(v1.getTask(taskId)).rejects.toMatchObject({
        status: 401, code: "UNAUTHORIZED", message: "请重新登录", field: null, stage: null,
      })
      expect(unauthorized).toHaveBeenCalledTimes(1)
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
      await v1.deleteTask(taskId)
      expect(new Headers(fetchMock.mock.calls.at(-1)![1]?.headers).has("X-CSRF-Token")).toBe(false)
    } finally {
      window.removeEventListener(api.AUTH_UNAUTHORIZED_EVENT, unauthorized)
    }
  })

  it("既有登录错误保持 detail 格式且不广播未授权事件", async () => {
    const unauthorized = vi.fn()
    window.addEventListener(api.AUTH_UNAUTHORIZED_EVENT, unauthorized)
    try {
      fetchMock.mockResolvedValueOnce(jsonResponse({ detail: "密码错误" }, 401))
      await expect(api.login("incorrect")).rejects.toMatchObject({ status: 401, message: "密码错误", code: undefined })
      expect(unauthorized).not.toHaveBeenCalled()
    } finally {
      window.removeEventListener(api.AUTH_UNAUTHORIZED_EVENT, unauthorized)
    }
  })

  it("操作封装传递明确的 attempt 和新任务 id，204 删除不读取 JSON", async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ id: taskId }))
    await v1.cancelTask(taskId)
    expect(fetchMock.mock.calls.at(-1)!.slice(0, 1)).toEqual([`/api/v1/tasks/${taskId}/cancel`])
    expect(fetchMock.mock.calls.at(-1)![1]).toMatchObject({ method: "POST" })
    await v1.retryTask(taskId, 3)
    expect(JSON.parse(String(fetchMock.mock.calls.at(-1)![1]?.body))).toEqual({ expected_attempt: 3 })
    const rerun = { id: "4ddc069a-a889-4b78-9cc4-1f558875c370", config, acknowledge_external_risk: true }
    await v1.rerunTask(taskId, rerun)
    expect(JSON.parse(String(fetchMock.mock.calls.at(-1)![1]?.body))).toEqual(rerun)
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
    await expect(v1.deleteTask(taskId)).resolves.toBeUndefined()
    expect(fetchMock.mock.calls.at(-1)![1]).toMatchObject({ method: "DELETE" })
  })

  it("日志读取纯文本并保留 v1 错误，文件与下载地址遵循协议", async () => {
    const signal = new AbortController().signal
    fetchMock.mockResolvedValueOnce(new Response("[prepare] ready\n", { headers: { "Content-Type": "text/plain" } }))
    await expect(v1.getTaskLog(taskId, { lines: 50 }, signal)).resolves.toBe("[prepare] ready\n")
    expect(fetchMock.mock.calls.at(-1)![0]).toBe(`/api/v1/tasks/${taskId}/log?lines=50`)
    expect(fetchMock.mock.calls.at(-1)![1]?.signal).toBe(signal)
    expect(v1.getTaskLogUrl(taskId, { download: true })).toBe(`/api/v1/tasks/${taskId}/log?download=true`)
    expect(v1.getTaskFileUrl(taskId, "translated_subtitles")).toBe(`/api/v1/tasks/${taskId}/files/translated_subtitles`)
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: {
      code: "TASK_NOT_FOUND", message: "任务不存在", field: null, stage: null, action: "none",
    } }, 404))
    await expect(v1.getTaskLog(taskId)).rejects.toMatchObject({ status: 404, code: "TASK_NOT_FOUND", message: "任务不存在" })
  })
})
