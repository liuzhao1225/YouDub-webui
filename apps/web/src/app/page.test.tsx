import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import Home from "@/app/page"
import { LanguageProvider } from "@/lib/i18n"

const mocks = vi.hoisted(() => ({
  fetch: vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(),
  push: vi.fn(),
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}))

vi.mock("@/components/app-header", () => ({
  AppHeader: () => null,
}))

afterEach(() => {
  cleanup()
  window.localStorage.clear()
  vi.unstubAllGlobals()
})

describe("本地视频字幕选择", () => {
  it("切换视频后清除旧字幕，提交时不携带上一视频的字幕", async () => {
    mocks.fetch.mockImplementation(async (input: RequestInfo | URL) => {
      const path = String(input)
      if (path === "/api/tasks/upload") {
        return new Response(JSON.stringify({ id: "task-b" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      }
      if (path.startsWith("/api/tasks")) {
        return new Response(JSON.stringify({
          tasks: [],
          total: 0,
          active_count: 0,
          page: 1,
          page_size: 20,
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      }
      throw new Error(`未预期的请求: ${path}`)
    })
    vi.stubGlobal("fetch", mocks.fetch)

    const user = userEvent.setup()
    render(
      <LanguageProvider>
        <Home />
      </LanguageProvider>,
    )

    const videoInput = screen.getByLabelText("本地视频文件") as HTMLInputElement
    const subtitleInput = screen.getByLabelText("已翻译 SRT 字幕（可选）") as HTMLInputElement
    const videoA = new File(["video-a"], "video-a.mp4", { type: "video/mp4" })
    const subtitleA = new File(["subtitle-a"], "subtitle-a.srt", { type: "application/x-subrip" })
    const videoB = new File(["video-b"], "video-b.mp4", { type: "video/mp4" })

    await user.upload(videoInput, videoA)
    await user.upload(subtitleInput, subtitleA)

    expect(screen.getByTestId("local-upload-selection")).toHaveTextContent("当前视频: video-a.mp4")
    expect(screen.getByTestId("local-upload-selection")).toHaveTextContent("当前视频关联字幕: subtitle-a.srt")

    await user.upload(videoInput, videoB)

    expect(screen.getByTestId("local-upload-selection")).toHaveTextContent("当前视频: video-b.mp4")
    expect(screen.getByTestId("local-upload-selection")).toHaveTextContent("当前视频关联字幕: 未选择")
    expect(subtitleInput.files).toHaveLength(0)

    await user.click(screen.getByRole("button", { name: "创建任务" }))

    await waitFor(() => {
      expect(mocks.fetch).toHaveBeenCalledWith(
        "/api/tasks/upload",
        expect.objectContaining({ method: "POST" }),
      )
    })
    const uploadCall = mocks.fetch.mock.calls.find(([input]) => String(input) === "/api/tasks/upload")
    const form = uploadCall?.[1]?.body as FormData
    expect((form.get("file") as File).name).toBe("video-b.mp4")
    expect(form.has("subtitle_file")).toBe(false)
    expect(mocks.push).toHaveBeenCalledWith("/tasks/task-b")
  })
})

describe("任务列表轮询", () => {
  it("筛选变化后丢弃已取消请求的迟到响应", async () => {
    let resolveOldRequest!: (response: Response) => void
    const oldRequest = new Promise<Response>((resolve) => {
      resolveOldRequest = resolve
    })
    let listRequestCount = 0

    mocks.fetch.mockImplementation(async (input: RequestInfo | URL) => {
      const path = String(input)
      if (!path.startsWith("/api/tasks")) throw new Error(`未预期的请求: ${path}`)
      listRequestCount += 1
      if (listRequestCount === 1) return oldRequest
      return new Response(JSON.stringify({
        tasks: [{
          id: "new-task",
          url: "https://example.com/new",
          title: "新列表任务",
          status: "succeeded",
          current_stage: "done",
          final_video_path: null,
          error_message: null,
          created_at: "2026-07-14T00:00:00Z",
          started_at: null,
          completed_at: null,
          execution_mode: "auto",
        }],
        total: 1,
        active_count: 37,
        page: 1,
        page_size: 20,
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    })
    vi.stubGlobal("fetch", mocks.fetch)

    render(
      <LanguageProvider>
        <Home />
      </LanguageProvider>,
    )

    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(1))
    fireEvent.change(screen.getByPlaceholderText("搜索标题、链接或任务 ID"), {
      target: { value: "new" },
    })

    expect(await screen.findByText("新列表任务")).toBeInTheDocument()
    const oldSignal = mocks.fetch.mock.calls[0][1]?.signal
    expect(oldSignal?.aborted).toBe(true)

    await act(async () => {
      resolveOldRequest(new Response(JSON.stringify({
        tasks: [{
          id: "old-task",
          url: "https://example.com/old",
          title: "迟到的旧任务",
          status: "running",
          current_stage: "download",
          final_video_path: null,
          error_message: null,
          created_at: "2026-07-13T00:00:00Z",
          started_at: null,
          completed_at: null,
          execution_mode: "auto",
        }],
        total: 1,
        active_count: 2,
        page: 1,
        page_size: 20,
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }))
      await Promise.resolve()
    })

    expect(screen.getByText("新列表任务")).toBeInTheDocument()
    expect(screen.getByText("37 个任务正在排队或运行")).toBeInTheDocument()
    expect(screen.queryByText("迟到的旧任务")).not.toBeInTheDocument()
  })
})

describe("全局活跃任务数", () => {
  it("切换到已完成筛选后仍显示超过单页容量的全局活跃数", async () => {
    mocks.fetch.mockImplementation(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost")
      if (url.pathname !== "/api/tasks") throw new Error(`未预期的请求: ${url.pathname}`)
      const succeededOnly = url.searchParams.get("status") === "succeeded"
      return new Response(JSON.stringify({
        tasks: succeededOnly ? [{
          id: "completed-task",
          url: "https://example.com/completed",
          title: "已完成筛选结果",
          status: "succeeded",
          current_stage: "done",
          final_video_path: null,
          error_message: null,
          created_at: "2026-07-14T00:00:00Z",
          started_at: null,
          completed_at: "2026-07-14T01:00:00Z",
          execution_mode: "auto",
        }] : [],
        total: succeededOnly ? 1 : 0,
        active_count: succeededOnly ? 37 : 0,
        page: 1,
        page_size: 20,
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    })
    vi.stubGlobal("fetch", mocks.fetch)

    const user = userEvent.setup()
    render(
      <LanguageProvider>
        <Home />
      </LanguageProvider>,
    )

    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(1))
    await user.click(screen.getByLabelText("状态"))
    await user.click(await screen.findByRole("option", { name: "已完成" }))

    expect(await screen.findByText("已完成筛选结果")).toBeInTheDocument()
    expect(screen.getByText("37 个任务正在排队或运行")).toBeInTheDocument()
    expect(mocks.fetch.mock.calls.some(([input]) => (
      new URL(String(input), "http://localhost").searchParams.get("status") === "succeeded"
    ))).toBe(true)
  })
})
