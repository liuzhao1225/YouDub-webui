import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import Home from "@/app/page"
import { LanguageProvider } from "@/lib/i18n"
import uploadContract from "@/lib/upload-contract.json"

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
    expect(videoInput.accept).toBe(uploadContract.video_extensions.join(","))
    expect(videoInput.accept).not.toContain("video/*")
    expect(videoInput.accept).not.toContain(".3gp")
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

describe("任务搜索校验错误", () => {
  it("限制搜索长度，将错误数组显示为可读文本，并在恢复成功后清除错误", async () => {
    mocks.fetch.mockImplementation(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost")
      if (url.pathname !== "/api/tasks") throw new Error(`未预期的请求: ${url.pathname}`)
      const query = url.searchParams.get("q") || ""
      if (query === "broken") {
        return new Response(JSON.stringify({
          detail: [{
            type: "string_too_long",
            loc: ["query", "q"],
            msg: "搜索条件最多 200 个字符",
            input: "不得显示的原始输入",
          }],
        }), {
          status: 422,
          headers: { "Content-Type": "application/json" },
        })
      }
      if (query === "malformed") {
        return new Response(JSON.stringify({
          detail: ["不得显示的数组裸字符串"],
        }), {
          status: 422,
          headers: { "Content-Type": "application/json" },
        })
      }
      return new Response(JSON.stringify({
        tasks: query === "fixed" ? [{
          id: "recovered-task",
          url: "https://example.com/recovered",
          title: "恢复后的任务",
          status: "succeeded",
          current_stage: "done",
          final_video_path: null,
          error_message: null,
          created_at: "2026-07-14T00:00:00Z",
          started_at: null,
          completed_at: "2026-07-14T01:00:00Z",
          execution_mode: "auto",
        }] : [],
        total: query === "fixed" ? 1 : 0,
        active_count: 0,
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

    const search = screen.getByPlaceholderText("搜索标题、链接或任务 ID")
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(1))

    const oversizedQuery = "😀".repeat(201)
    fireEvent.change(search, { target: { value: oversizedQuery } })
    expect(search).toHaveValue("😀".repeat(200))
    await waitFor(() => {
      expect(mocks.fetch.mock.calls.some(([input]) => (
        Array.from(new URL(String(input), "http://localhost").searchParams.get("q") || "").length === 200
      ))).toBe(true)
    })

    fireEvent.change(search, { target: { value: "broken" } })

    expect(await screen.findByText("搜索条件最多 200 个字符")).toBeInTheDocument()
    expect(screen.queryByText("[object Object]")).not.toBeInTheDocument()
    expect(document.body).not.toHaveTextContent("不得显示的原始输入")

    fireEvent.change(search, { target: { value: "malformed" } })

    expect(await screen.findByText("Request failed: 422")).toBeInTheDocument()
    expect(document.body).not.toHaveTextContent("不得显示的数组裸字符串")

    fireEvent.change(search, { target: { value: "fixed" } })

    expect(await screen.findByText("恢复后的任务")).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.queryByText("搜索条件最多 200 个字符")).not.toBeInTheDocument()
    })
  })

  it("迟到的旧成功响应不能清除新查询错误", async () => {
    let resolveOldRequest!: (response: Response) => void
    const oldRequest = new Promise<Response>((resolve) => {
      resolveOldRequest = resolve
    })
    let requestCount = 0
    mocks.fetch.mockImplementation(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost")
      if (url.pathname !== "/api/tasks") throw new Error(`未预期的请求: ${url.pathname}`)
      requestCount += 1
      if (requestCount === 1) return oldRequest
      return new Response(JSON.stringify({
        detail: [{ msg: "当前查询仍然失败", input: "不得显示" }],
      }), {
        status: 422,
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
      target: { value: "new-query" },
    })
    expect(await screen.findByText("当前查询仍然失败")).toBeInTheDocument()

    await act(async () => {
      resolveOldRequest(new Response(JSON.stringify({
        tasks: [],
        total: 0,
        active_count: 0,
        page: 1,
        page_size: 20,
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }))
      await Promise.resolve()
    })

    expect(screen.getByText("当前查询仍然失败")).toBeInTheDocument()
  })

  it("列表恢复成功不会清除创建任务错误", async () => {
    mocks.fetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "http://localhost")
      const method = init?.method || "GET"
      if (url.pathname === "/api/tasks" && method === "POST") {
        return new Response(JSON.stringify({ detail: "创建任务失败" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        })
      }
      if (url.pathname === "/api/tasks" && method === "GET") {
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
      throw new Error(`未预期的请求: ${method} ${url.pathname}`)
    })
    vi.stubGlobal("fetch", mocks.fetch)

    const user = userEvent.setup()
    render(
      <LanguageProvider>
        <Home />
      </LanguageProvider>,
    )
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(1))
    await user.type(screen.getByLabelText(/YouTube 链接/), "https://www.youtube.com/watch?v=testvideo01")
    await user.click(screen.getByRole("button", { name: "创建任务" }))
    expect(await screen.findByText("创建任务失败")).toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText("搜索标题、链接或任务 ID"), {
      target: { value: "refresh" },
    })
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(3))

    expect(screen.getByText("创建任务失败")).toBeInTheDocument()
  })
})
