import { Suspense } from "react"
import { act, cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import TaskDetailPage from "@/app/tasks/[id]/page"
import { Task, TaskStatus } from "@/lib/api"
import { LanguageProvider } from "@/lib/i18n"

const mocks = vi.hoisted(() => ({
  fetch: vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(),
  replace: vi.fn(),
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
}))

vi.mock("@/components/app-header", () => ({
  AppHeader: () => null,
}))

function taskWithStatus(status: TaskStatus): Task {
  return {
    id: "task-race",
    url: "https://example.com/task-race",
    title: "轮询竞态任务",
    status,
    current_stage: status === "queued" ? "separate" : "download",
    session_path: null,
    final_video_path: null,
    error_message: null,
    created_at: "2026-07-14T00:00:00Z",
    started_at: null,
    completed_at: null,
    execution_mode: "manual",
    output_mode: "dubbing",
    stages: [{
      task_id: "task-race",
      name: "download",
      label: "Download",
      status: status === "paused" ? "succeeded" : "pending",
      progress: status === "paused" ? 100 : null,
      started_at: null,
      completed_at: null,
      last_message: null,
      error_message: null,
    }],
  }
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })
}

afterEach(() => {
  cleanup()
  window.localStorage.clear()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("任务详情轮询", () => {
  it("continue 返回新状态后不会被动作前的迟到轮询覆盖", async () => {
    let resolveOldPoll!: (response: Response) => void
    const oldPoll = new Promise<Response>((resolve) => {
      resolveOldPoll = resolve
    })
    let taskGetCount = 0

    mocks.fetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input)
      const method = init?.method || "GET"
      if (method === "GET" && path === "/api/tasks/task-race") {
        taskGetCount += 1
        return taskGetCount === 1 ? jsonResponse(taskWithStatus("paused")) : oldPoll
      }
      if (method === "GET" && path === "/api/tasks/task-race/log") {
        return new Response("initial log", { status: 200 })
      }
      if (method === "POST" && path === "/api/tasks/task-race/continue") {
        return jsonResponse(taskWithStatus("queued"))
      }
      throw new Error(`未预期的请求: ${method} ${path}`)
    })
    vi.stubGlobal("fetch", mocks.fetch)

    const user = userEvent.setup()
    const params = Promise.resolve({ id: "task-race" })
    await act(async () => {
      render(
        <LanguageProvider>
          <Suspense fallback={<div>loading</div>}>
            <TaskDetailPage params={params} />
          </Suspense>
        </LanguageProvider>,
      )
      await params
    })

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "执行下一阶段" })).toBeInTheDocument()
    })
    expect(screen.getByText("配音（无硬字幕）")).toBeInTheDocument()

    await waitFor(() => expect(taskGetCount).toBe(2), { timeout: 3500 })

    const oldPollCall = mocks.fetch.mock.calls.findLast(
      ([input, init]) => String(input) === "/api/tasks/task-race" && (init?.method || "GET") === "GET",
    )
    await user.click(screen.getByRole("button", { name: "执行下一阶段" }))
    await waitFor(() => expect(screen.getByText("排队中")).toBeInTheDocument())
    expect(oldPollCall?.[1]?.signal?.aborted).toBe(true)

    await act(async () => {
      resolveOldPoll(jsonResponse(taskWithStatus("paused")))
      await Promise.resolve()
    })

    expect(screen.getByText("排队中")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "执行下一阶段" })).not.toBeInTheDocument()
  })

  it("已跳过阶段计入完成进度并显示输出语义", async () => {
    const completed = taskWithStatus("succeeded")
    completed.output_mode = "subtitles"
    completed.stages = [
      { ...completed.stages[0], status: "succeeded", progress: 100 },
      {
        ...completed.stages[0],
        name: "tts",
        label: "VoxCPM",
        status: "skipped",
        progress: 100,
        last_message: "Skipped for output mode: subtitles",
      },
    ]
    mocks.fetch.mockImplementation(async (input: RequestInfo | URL) => {
      const path = String(input)
      if (path === "/api/tasks/task-race") return jsonResponse(completed)
      if (path === "/api/tasks/task-race/log") return new Response("done", { status: 200 })
      throw new Error(`未预期的请求: ${path}`)
    })
    vi.stubGlobal("fetch", mocks.fetch)

    const params = Promise.resolve({ id: "task-race" })
    await act(async () => {
      render(
        <LanguageProvider>
          <Suspense fallback={<div>loading</div>}>
            <TaskDetailPage params={params} />
          </Suspense>
        </LanguageProvider>,
      )
      await params
    })

    expect(await screen.findByText("硬字幕（保留原音）")).toBeInTheDocument()
    expect(screen.getByText("已跳过")).toBeInTheDocument()
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100")
  })
})
