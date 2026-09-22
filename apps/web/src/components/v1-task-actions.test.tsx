import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { TaskActions } from "@/components/v1-task-actions"
import { LanguageProvider } from "@/lib/i18n"
import { jsonResponse, testRuntime, testSettings, testTask } from "@/lib/v1-test-fixtures"
import type { Task } from "@/lib/v1-api"

const mocks = vi.hoisted(() => ({ fetch: vi.fn<typeof fetch>(), push: vi.fn(), start: vi.fn(), end: vi.fn(), change: vi.fn(), deleted: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }))
beforeEach(() => { mocks.fetch.mockReset(); vi.stubGlobal("fetch", mocks.fetch) })
afterEach(() => { cleanup(); window.localStorage.clear(); vi.unstubAllGlobals() })

function mount(task: Task) {
  render(<LanguageProvider><TaskActions task={task} onMutationStart={mocks.start} onMutationEnd={mocks.end} onTaskChange={mocks.change} onDeleted={mocks.deleted} /></LanguageProvider>)
}

function configResponse(input: RequestInfo | URL) {
  if (String(input) === "/api/v1/runtime") return jsonResponse(testRuntime())
  if (String(input) === "/api/v1/settings") return jsonResponse(testSettings())
  throw new Error(`Unexpected request: ${input}`)
}

describe("v1 任务操作", () => {
  it("仅展示 allowed_actions；取消 202 使用服务端 cancelling 状态", async () => {
    const task = testTask({ status: "waiting", current_stage: "asr", allowed_actions: ["cancel"] })
    const cancelling = { ...task, status: "cancelling", allowed_actions: [] }
    mocks.fetch.mockResolvedValueOnce(jsonResponse(cancelling, 202))
    mount(task)
    expect(screen.queryByRole("button", { name: /重试|重新生成|删除/ })).not.toBeInTheDocument()
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "取消任务" }))
    await waitFor(() => expect(mocks.change).toHaveBeenCalledWith(cancelling))
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    expect(mocks.fetch.mock.calls[0][0]).toBe(`/api/v1/tasks/${task.id}/cancel`)
    expect(mocks.start).toHaveBeenCalledTimes(1)
    expect(mocks.end).toHaveBeenCalledTimes(1)
  })

  it("模型不可用只阻止重新生成，原配置重试仍可执行", async () => {
    const runtime = testRuntime()
    runtime.capabilities[0].available = false
    runtime.capabilities[0].unavailable_reason = "模型未就绪"
    const task = testTask({ status: "failed", allowed_actions: ["retry", "rerun", "delete"], attempt: 2 })
    mocks.fetch.mockImplementation(async (input) => {
      if (String(input) === "/api/v1/runtime") return jsonResponse(runtime)
      if (String(input).endsWith("/retry")) return jsonResponse(testTask({ attempt: 3 }))
      return configResponse(input)
    })
    mount(task)
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "重新生成" }))
    expect(await screen.findByRole("button", { name: "创建新任务" })).toBeDisabled()
    await user.keyboard("{Escape}")
    expect(screen.getByRole("button", { name: "从头重试" })).toBeEnabled()
    await user.click(screen.getByRole("button", { name: "从头重试" }))
    await waitFor(() => expect(mocks.change).toHaveBeenCalledWith(expect.objectContaining({ attempt: 3 })))
    const [, request] = mocks.fetch.mock.calls.find(([path]) => String(path).endsWith("/retry"))!
    expect(JSON.parse(String(request?.body))).toEqual({ expected_attempt: 2 })
  })

  it("远端状态未明时必须勾选风险，重新生成发送新 ID 和修改后的配置", async () => {
    const source = testTask({ status: "cancelled", allowed_actions: ["rerun", "delete"], external_operation: { state: "unknown", may_still_run: true } })
    mocks.fetch.mockImplementation(async (input, init) => String(input).endsWith("/rerun")
      ? jsonResponse(testTask(JSON.parse(String(init?.body))), 201) : configResponse(input))
    mount(source)
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "重新生成" }))
    const submit = await screen.findByRole("button", { name: "创建新任务" })
    expect(submit).toBeDisabled()
    await user.selectOptions(screen.getByLabelText("目标语言"), "ja")
    await user.click(screen.getByRole("checkbox", { name: /我已知悉原远端请求/ }))
    expect(submit).toBeEnabled()
    await user.click(submit)
    await waitFor(() => expect(mocks.push).toHaveBeenCalled())
    const [, init] = mocks.fetch.mock.calls.find(([path]) => String(path).endsWith("/rerun"))!
    const body = JSON.parse(String(init?.body))
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(body.id).not.toBe(source.id)
    expect(body.acknowledge_external_risk).toBe(true)
    expect(body.config.target_language).toBe("ja")
    expect(source.config.target_language).toBe("zh")
    expect(mocks.push).toHaveBeenCalledWith(`/tasks/${body.id}`)
  })

  it("重新生成响应不确定时保留新 ID，关闭再打开后按同一请求重发", async () => {
    const requests: Array<{ id: string }> = []
    let runtimeReads = 0
    mocks.fetch.mockImplementation(async (input, init) => {
      if (String(input) === "/api/v1/runtime" && ++runtimeReads > 1) return jsonResponse({ error: {
        code: "RUNTIME_UNAVAILABLE", message: "能力目录暂不可读", field: null, stage: null, action: "none",
      } }, 503)
      if (String(input).endsWith("/rerun")) {
        requests.push(JSON.parse(String(init?.body)))
        if (requests.length === 1) throw new TypeError("请求响应中断")
        return jsonResponse(testTask({ id: requests[0].id }), 201)
      }
      return configResponse(input)
    })
    mount(testTask({ status: "failed", allowed_actions: ["rerun", "delete"] }))
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "重新生成" }))
    await user.click(await screen.findByRole("button", { name: "创建新任务" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("请求响应中断")
    expect(screen.getByLabelText("目标语言")).toBeDisabled()
    await user.keyboard("{Escape}")
    await user.click(screen.getByRole("button", { name: "重新生成" }))
    expect(await screen.findByText(requests[0].id)).toBeInTheDocument()
    expect(await screen.findByText("能力目录暂不可读")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "使用同一 ID 重新提交" }))
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith(`/tasks/${requests[0].id}`))
    expect(requests).toHaveLength(2)
    expect(requests[1]).toEqual(requests[0])
  })

  it("重新生成明确失败后的清理只删除新 ID，保留源任务", async () => {
    const source = testTask({ status: "failed", allowed_actions: ["rerun", "delete"] })
    let newId = ""
    mocks.fetch.mockImplementation(async (input, init) => {
      if (String(input).endsWith("/rerun")) {
        newId = JSON.parse(String(init?.body)).id
        return jsonResponse({ error: { code: "IMPORT_RESIDUE", message: "复制残留需要清理", field: "id", stage: null, action: "none" } }, 409)
      }
      if (init?.method === "DELETE") return new Response(null, { status: 204 })
      return configResponse(input)
    })
    mount(source)
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "重新生成" }))
    await user.click(await screen.findByRole("button", { name: "创建新任务" }))
    await screen.findByRole("alert")
    expect(screen.getByLabelText("目标语言")).toBeEnabled()
    await user.selectOptions(screen.getByLabelText("目标语言"), "ja")
    await user.click(screen.getByRole("button", { name: "清理本次复制残留" }))
    await waitFor(() => expect(screen.getByRole("button", { name: "创建新任务" })).toBeEnabled())
    expect(mocks.fetch.mock.calls.find(([, init]) => init?.method === "DELETE")![0]).toBe(`/api/v1/tasks/${newId}`)
    expect(newId).not.toBe(source.id)
    expect(mocks.deleted).not.toHaveBeenCalled()
    expect(screen.getByLabelText("目标语言")).toHaveValue("ja")
  })

  it("删除失败保留任务，确认删除成功后通知详情返回首页", async () => {
    mocks.fetch.mockResolvedValueOnce(jsonResponse({ error: { code: "TASK_BUSY", message: "文件正在读取", field: "id", stage: null, action: "none" } }, 409))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    mount(testTask({ status: "failed", allowed_actions: ["delete"] }))
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "删除任务" }))
    await user.click(screen.getByRole("button", { name: "删除任务和文件" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("文件正在读取")
    expect(mocks.deleted).not.toHaveBeenCalled()
    await user.click(screen.getByRole("button", { name: "删除任务和文件" }))
    await waitFor(() => expect(mocks.deleted).toHaveBeenCalledTimes(1))
  })
})
