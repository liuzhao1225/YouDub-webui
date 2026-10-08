import { cleanup, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import Home from "@/app/(app)/page"
import { LanguageProvider } from "@/lib/i18n"
import { jsonResponse, readBlob, testConfig, testRuntime, testSettings, testTask } from "@/lib/v1-test-fixtures"

const mocks = vi.hoisted(() => ({ fetch: vi.fn<typeof fetch>(), push: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }))

function mount() { render(<LanguageProvider><Home /></LanguageProvider>) }
function defaultResponse(input: RequestInfo | URL) {
  const path = String(input)
  if (path === "/api/v1/runtime") return jsonResponse(testRuntime())
  if (path === "/api/v1/settings") return jsonResponse(testSettings())
  if (path.startsWith("/api/v1/tasks?")) return jsonResponse({ items: [], limit: 12, offset: 0, has_more: false })
  throw new Error(`Unexpected request: ${path}`)
}

async function choose(user: ReturnType<typeof userEvent.setup>, label: string, option: string) {
  await user.click(screen.getByLabelText(label))
  await user.click(await screen.findByRole("option", { name: option }))
}

async function selectVideo(user: ReturnType<typeof userEvent.setup>, name = "test.mp4") {
  const input = await screen.findByLabelText("本地视频")
  await waitFor(() => expect(input).toBeEnabled())
  await user.upload(input, new File(["video"], name, { type: "video/mp4" }))
  return input
}

beforeEach(() => {
  mocks.fetch.mockReset(); mocks.push.mockReset()
  mocks.fetch.mockImplementation(async (input) => defaultResponse(input))
  vi.stubGlobal("fetch", mocks.fetch)
})
afterEach(() => { cleanup(); window.localStorage.clear(); vi.unstubAllGlobals() })

describe("v1 工作台", () => {
  it("真实能力不可用时显示原因并禁用创建", async () => {
    const runtime = testRuntime()
    runtime.capabilities[0].available = false
    runtime.capabilities[0].unavailable_reason = "尚未安装识别模型"
    mocks.fetch.mockImplementation(async (input) => String(input) === "/api/v1/runtime" ? jsonResponse(runtime) : defaultResponse(input))
    mount()
    const user = userEvent.setup()
    await selectVideo(user)
    expect(screen.getByText(/尚未安装识别模型/, { selector: "span" })).toBeInTheDocument()
    expect(screen.getByText("请为每个必需步骤选择可用模型。", { exact: false })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "创建任务" })).toBeDisabled()
    expect(mocks.fetch.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false)
  })

  it("按 Runtime 选择输出模式，字幕上传清除 TTS、分离和背景选项", async () => {
    mocks.fetch.mockImplementation(async (input, init) => init?.method === "POST" ? jsonResponse(testTask(), 201) : defaultResponse(input))
    mount()
    const user = userEvent.setup()
    const input = await selectVideo(user)
    expect(input).toHaveAttribute("accept", ".mp4,.mov")
    await user.click(screen.getByRole("button", { name: "更多设置" }))
    await user.type(screen.getByLabelText("专名提示（可选）"), "YouDub")
    await choose(user, "输出内容", "配音与字幕")
    await user.click(screen.getByRole("switch", { name: "保留背景音" }))
    expect(screen.getByLabelText("音源分离模型")).toBeInTheDocument()
    await choose(user, "输出内容", "字幕 · 保留原声")
    expect(screen.queryByLabelText("配音模型")).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "创建任务" }))
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith(`/tasks/${testTask().id}`))
    const [, init] = mocks.fetch.mock.calls.find(([, init]) => init?.method === "POST")!
    const body = init?.body as FormData
    expect(body.get("id")).toMatch(/^[0-9a-f-]{36}$/)
    expect((body.get("file") as File).name).toBe("test.mp4")
    // 表单按输出模式规范化配置：字幕模式下 subtitle_alignment 明确为 null（按字数估算）。
    expect(JSON.parse(await readBlob(body.get("config") as Blob))).toEqual({ ...testConfig, subtitle_alignment: null, asr: { ...testConfig.asr, initial_prompt: "YouDub" } })
  })

  it("超过上传上限或格式不支持时直接提示，不选中文件", async () => {
    mount()
    // 文件框的 accept 只是选择器提示，拖放等途径仍可能带来其他格式，这里绕过它验证校验逻辑。
    const user = userEvent.setup({ applyAccept: false })
    await selectVideo(user, "clip.avi")
    expect(screen.getByRole("alert")).toHaveTextContent("不支持该视频格式。")
    expect(screen.getByRole("button", { name: "创建任务" })).toBeDisabled()
    expect(screen.queryByText("clip.avi")).not.toBeInTheDocument()
  })

  it("上传连接断开后查询和显式重新上传均保留同一个 ID", async () => {
    let uploadCount = 0
    const ids: string[] = []
    mocks.fetch.mockImplementation(async (input, init) => {
      const path = String(input)
      if (init?.method === "POST") {
        ids.push(String((init.body as FormData).get("id")))
        if (++uploadCount === 1) throw new TypeError("上传连接断开")
        return jsonResponse(testTask({ id: ids[0] }), 201)
      }
      if (path === `/api/v1/tasks/${ids[0]}`) return jsonResponse({ error: { code: "TASK_NOT_FOUND", message: "任务尚未入库", field: null, stage: null, action: "none" } }, 404)
      return defaultResponse(input)
    })
    mount()
    const user = userEvent.setup()
    await selectVideo(user)
    await user.click(screen.getByRole("button", { name: "创建任务" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("上传连接断开")
    expect(screen.getByLabelText("本地视频")).toBeDisabled()
    await user.click(screen.getByRole("button", { name: "查询原任务" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("任务尚未入库")
    await user.click(screen.getByRole("button", { name: "使用同一 ID 重新上传" }))
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith(`/tasks/${ids[0]}`))
    expect(ids).toHaveLength(2)
    expect(ids[1]).toBe(ids[0])
  })

  it("默认配置通过独立 Settings PATCH 保存，不创建任务", async () => {
    mocks.fetch.mockImplementation(async (input, init) => init?.method === "PATCH" ? jsonResponse(testSettings()) : defaultResponse(input))
    mount()
    const user = userEvent.setup()
    await user.click(await screen.findByRole("button", { name: "更多设置" }))
    await user.type(screen.getByLabelText("专名提示（可选）"), "Example brand")
    await user.click(screen.getByRole("button", { name: "保存为默认配置" }))
    expect(await screen.findByRole("status")).toHaveTextContent("已有任务配置保持不变")
    const [path, init] = mocks.fetch.mock.calls.find(([, init]) => init?.method === "PATCH")!
    expect(path).toBe("/api/v1/settings")
    expect(JSON.parse(String(init?.body))).toEqual({ defaults: { ...testConfig, subtitle_alignment: null, asr: { ...testConfig.asr, initial_prompt: "Example brand" } } })
    expect(mocks.fetch.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false)
  })

  it.each([
    { code: "FILE_TOO_LARGE", status: 413, message: "文件超过服务端限制" },
    { code: "IMPORT_RESIDUE", status: 409, message: "需要清理上传残留" },
  ])("$code 保留失败 ID，允许修正文件并在显式清理后重新创建", async (failure) => {
    const uploadedIds: string[] = []
    mocks.fetch.mockImplementation(async (input, init) => {
      if (init?.method === "POST") {
        uploadedIds.push(String((init.body as FormData).get("id")))
        if (uploadedIds.length === 1) return jsonResponse({ error: { code: failure.code, message: failure.message, field: "file", stage: null, action: "none" } }, failure.status)
        return jsonResponse(testTask({ id: uploadedIds[1] }), 201)
      }
      if (init?.method === "DELETE") return new Response(null, { status: 204 })
      return defaultResponse(input)
    })
    mount()
    const user = userEvent.setup()
    const fileInput = await selectVideo(user, "first.mp4")
    await user.click(screen.getByRole("button", { name: "创建任务" }))
    expect(await screen.findByRole("alert")).toHaveTextContent(failure.message)
    expect(screen.getByText(uploadedIds[0])).toBeInTheDocument()
    expect(fileInput).not.toBeDisabled()
    await user.upload(fileInput, new File(["second"], "second.mp4", { type: "video/mp4" }))
    expect(screen.getByRole("button", { name: "创建任务" })).toBeDisabled()
    await user.click(screen.getByRole("button", { name: "清理本次失败上传" }))
    expect(mocks.fetch.mock.calls.find(([, init]) => init?.method === "DELETE")![0]).toBe(`/api/v1/tasks/${uploadedIds[0]}`)
    await user.click(screen.getByRole("button", { name: "创建任务" }))
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith(`/tasks/${uploadedIds[1]}`))
    expect(uploadedIds[1]).not.toBe(uploadedIds[0])
  })

  it("进行中与最近完成的任务分开展示", async () => {
    const running = testTask({ id: "4ddc069a-a889-4b78-9cc4-1f558875c370", source_name: "处理中.mp4", status: "running", current_stage: "asr", stage_progress: 0.4 })
    const done = testTask({ source_name: "已完成.mp4", status: "succeeded", current_stage: "done", allowed_actions: ["rerun", "delete"] })
    mocks.fetch.mockImplementation(async (input) => String(input).startsWith("/api/v1/tasks?")
      ? jsonResponse({ items: [running, done], limit: 12, offset: 0, has_more: false }) : defaultResponse(input))
    mount()
    const active = await screen.findByRole("region", { name: /进行中/ })
    expect(within(active).getByRole("link", { name: /处理中\.mp4/ })).toHaveAttribute("href", `/tasks/${running.id}`)
    expect(within(active).getByText("语音识别 · 40%")).toBeInTheDocument()
    const recent = screen.getByRole("region", { name: "最近任务" })
    expect(within(recent).getByRole("link", { name: /已完成\.mp4/ })).toHaveAttribute("href", `/tasks/${done.id}`)
    expect(within(recent).queryByText("处理中.mp4")).not.toBeInTheDocument()
    expect(screen.getByText("1 个任务正在排队或处理")).toBeInTheDocument()
  })
})
