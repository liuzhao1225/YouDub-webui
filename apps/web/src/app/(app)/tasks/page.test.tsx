import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import TasksPage from "@/app/(app)/tasks/page"
import { LanguageProvider } from "@/lib/i18n"
import type { TaskSummary } from "@/lib/v1-api"
import { jsonResponse, testTask } from "@/lib/v1-test-fixtures"

const mocks = vi.hoisted(() => ({ fetch: vi.fn<typeof fetch>() }))

function mount() { render(<LanguageProvider><TasksPage /></LanguageProvider>) }

function task(index: number, patch: Partial<TaskSummary> = {}): TaskSummary {
  const id = `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`
  return testTask({ id, source_name: `视频 ${index}.mp4`, status: "succeeded", current_stage: "done", allowed_actions: ["rerun", "delete"], ...patch })
}

function listResponse(items: TaskSummary[], limit: number, offset: number, has_more: boolean) {
  return jsonResponse({ items, limit, offset, has_more })
}

beforeEach(() => { mocks.fetch.mockReset(); vi.stubGlobal("fetch", mocks.fetch) })
afterEach(() => { cleanup(); window.localStorage.clear(); vi.useRealTimers(); vi.unstubAllGlobals() })

describe("v1 任务库", () => {
  it("筛选切换后丢弃旧响应，使用 v1 active 和 offset 参数", async () => {
    let resolveOld!: (response: Response) => void
    const oldResponse = new Promise<Response>((resolve) => { resolveOld = resolve })
    mocks.fetch.mockImplementation(async (input) => {
      const path = String(input)
      if (path === "/api/v1/tasks?limit=10&offset=0") return oldResponse
      if (path === "/api/v1/tasks?limit=10&offset=0&active=true") return listResponse([task(1, { source_name: "新筛选.mp4", status: "running", current_stage: "asr", allowed_actions: ["cancel"] })], 10, 0, false)
      throw new Error(`Unexpected request: ${path}`)
    })
    mount()
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "进行中" }))
    expect(await screen.findByRole("link", { name: /新筛选\.mp4/ })).toBeInTheDocument()
    await act(async () => resolveOld(listResponse([task(2, { source_name: "旧筛选.mp4" })], 10, 0, false)))
    expect(screen.queryByRole("link", { name: /旧筛选\.mp4/ })).not.toBeInTheDocument()
    expect(screen.getByRole("link", { name: /新筛选\.mp4/ })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "进行中" })).toHaveAttribute("aria-pressed", "true")
  })

  it("按 has_more 翻页，状态筛选使用 status 参数", async () => {
    mocks.fetch.mockImplementation(async (input) => {
      const path = String(input)
      if (path === "/api/v1/tasks?limit=10&offset=0") return listResponse(Array.from({ length: 10 }, (_, index) => task(index + 1)), 10, 0, true)
      if (path === "/api/v1/tasks?limit=10&offset=10") return listResponse([task(11, { source_name: "第二页.mp4" })], 10, 10, false)
      if (path === "/api/v1/tasks?limit=10&offset=0&status=failed") return listResponse([], 10, 0, false)
      throw new Error(`Unexpected request: ${path}`)
    })
    mount()
    const user = userEvent.setup()
    expect(await screen.findByText("第 1 页")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "上一页" })).toBeDisabled()
    await user.click(screen.getByRole("button", { name: "下一页" }))
    expect(await screen.findByRole("link", { name: /第二页\.mp4/ })).toBeInTheDocument()
    expect(screen.getByText("第 2 页")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "下一页" })).toBeDisabled()
    await user.click(screen.getByRole("button", { name: "失败" }))
    expect(await screen.findByText("暂无符合条件的任务。")).toBeInTheDocument()
  })

  it("进行中的任务不能勾选；选择所有页逐页拉取后批量删除，已不存在的视为删除成功", async () => {
    const running = task(1, { source_name: "处理中.mp4", status: "running", current_stage: "asr", stage_progress: 0.3, allowed_actions: ["cancel"] })
    const firstPage = [running, ...Array.from({ length: 9 }, (_, index) => task(index + 2))]
    const all = [...firstPage, ...Array.from({ length: 105 }, (_, index) => task(index + 11))]
    const deleted: string[] = []
    mocks.fetch.mockImplementation(async (input, init) => {
      const path = String(input)
      if (init?.method === "DELETE") {
        const id = path.split("/").at(-1)!
        deleted.push(id)
        if (id === all[5].id) return jsonResponse({ error: { code: "TASK_NOT_FOUND", message: "任务不存在", field: null, stage: null, action: "none" } }, 404)
        return new Response(null, { status: 204 })
      }
      if (path === "/api/v1/tasks?limit=10&offset=0") return listResponse(firstPage.filter((item) => !deleted.includes(item.id)), 10, 0, true)
      const page = /limit=100&offset=(\d+)$/.exec(path)
      if (page) {
        const offset = Number(page[1])
        return listResponse(all.slice(offset, offset + 100), 100, offset, offset + 100 < all.length)
      }
      throw new Error(`Unexpected request: ${path}`)
    })
    mount()
    const user = userEvent.setup()
    await screen.findByRole("link", { name: /处理中\.mp4/ })
    expect(screen.getByRole("checkbox", { name: "选择 处理中.mp4" })).toHaveAttribute("aria-disabled", "true")
    await user.click(screen.getByRole("checkbox", { name: "选择本页全部任务" }))
    expect(screen.getByText("已选择 9 个任务")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "选择所有页的任务" }))
    expect(await screen.findByText("已选择 114 个任务")).toBeInTheDocument()
    expect(screen.getByText("另有 1 个进行中的任务不能删除")).toBeInTheDocument()
    expect(mocks.fetch.mock.calls.map(([path]) => String(path)).filter((path) => path.includes("limit=100"))).toEqual([
      "/api/v1/tasks?limit=100&offset=0", "/api/v1/tasks?limit=100&offset=100",
    ])
    await user.click(screen.getByRole("button", { name: "删除所选" }))
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByText("确认删除 114 个任务？")).toBeInTheDocument()
    await user.click(within(dialog).getByRole("button", { name: "删除任务和文件" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    expect(deleted).toHaveLength(114)
    expect(deleted).not.toContain(running.id)
    expect(screen.queryByText(/已选择/)).not.toBeInTheDocument()
  })

  it("部分删除失败时保留对话框和失败的任务", async () => {
    const busy = task(2, { source_name: "占用中.mp4" })
    let items = [task(1), busy]
    mocks.fetch.mockImplementation(async (input, init) => {
      const path = String(input)
      if (init?.method === "DELETE") {
        if (path.endsWith(busy.id)) return jsonResponse({ error: { code: "TASK_BUSY", message: "文件正在读取", field: "id", stage: null, action: "none" } }, 409)
        items = items.filter((item) => !path.endsWith(item.id))
        return new Response(null, { status: 204 })
      }
      return listResponse(items, 10, 0, false)
    })
    mount()
    const user = userEvent.setup()
    await screen.findByRole("link", { name: /占用中\.mp4/ })
    await user.click(screen.getByRole("checkbox", { name: "选择本页全部任务" }))
    expect(screen.queryByRole("button", { name: "选择所有页的任务" })).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "删除所选" }))
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "删除任务和文件" }))
    expect(await within(screen.getByRole("dialog")).findByRole("alert")).toHaveTextContent("已删除 1 个，1 个删除失败：文件正在读取")
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "取消" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    expect(screen.getByRole("link", { name: /占用中\.mp4/ })).toBeInTheDocument()
    expect(screen.queryByRole("link", { name: /视频 1\.mp4/ })).not.toBeInTheDocument()
    expect(screen.getByText("已选择 1 个任务")).toBeInTheDocument()
  })
})
