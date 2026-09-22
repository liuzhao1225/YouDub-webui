import { Suspense } from "react"
import { act, cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import TaskDetailPage from "@/app/tasks/[id]/page"
import { LanguageProvider } from "@/lib/i18n"
import { jsonResponse, testTask } from "@/lib/v1-test-fixtures"
import type { OutputFile, Task } from "@/lib/v1-api"

const mocks = vi.hoisted(() => ({ fetch: vi.fn<typeof fetch>() }))
vi.mock("@/components/app-header", () => ({ AppHeader: () => null }))
beforeEach(() => { mocks.fetch.mockReset(); vi.stubGlobal("fetch", mocks.fetch) })
afterEach(() => { cleanup(); window.localStorage.clear(); vi.useRealTimers(); vi.unstubAllGlobals() })

async function mount() {
  const params = Promise.resolve({ id: testTask().id })
  await act(async () => { render(<LanguageProvider><Suspense fallback="Loading"><TaskDetailPage params={params} /></Suspense></LanguageProvider>) })
}

describe("v1 任务详情", () => {
  it("按真实 outputs 展示预览下载，字幕模式跳过分离、配音与混音", async () => {
    const base = `/api/v1/tasks/${testTask().id}/files/`
    const file: OutputFile = { url: base + "video", file_name: "video.mp4", mime_type: "video/mp4", size_bytes: 4096, duration_ms: 12000, timeline: "source" }
    const task = testTask({ status: "succeeded", current_stage: "done", finished_at: "2026-09-22T10:01:00.000Z", outputs: {
      video: file,
      source_subtitles: { ...file, url: base + "source_subtitles", file_name: "source.srt", mime_type: "application/x-subrip", duration_ms: null },
      translated_subtitles: { ...file, url: base + "translated_subtitles", file_name: "translated.srt", mime_type: "application/x-subrip", duration_ms: null },
    } })
    mocks.fetch.mockImplementation(async () => jsonResponse(task))
    await mount()
    await screen.findByRole("heading", { name: "示例.mp4" })
    expect(screen.getByLabelText("视频预览")).toHaveAttribute("src", base + "video")
    expect(screen.getAllByRole("link", { name: "下载" }).map((link) => link.getAttribute("href"))).toEqual([
      base + "video?download=true", base + "source_subtitles?download=true", base + "translated_subtitles?download=true",
    ])
    expect(screen.getAllByText("已跳过")).toHaveLength(3)
    expect(screen.getByRole("heading", { name: "本次任务配置" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /重试|取消|删除/ })).not.toBeInTheDocument()
    expect(mocks.fetch.mock.calls.every(([path]) => path === `/api/v1/tasks/${task.id}`)).toBe(true)
  })

  it("阶段进度把 0–1 转为百分比，显示远端等待与完整任务错误", async () => {
    const task = testTask({ status: "failed", current_stage: "asr", stage_progress: 0.25,
      external_operation: { state: "unknown", may_still_run: true },
      error: { code: "PROVIDER_REJECTED", message: "凭据被拒绝", field: "config.asr", stage: "asr", action: "adjust_settings" },
      finished_at: "2026-09-22T10:01:00.000Z" })
    mocks.fetch.mockImplementation(async () => jsonResponse(task))
    await mount()
    expect(await screen.findByRole("alert")).toHaveTextContent("凭据被拒绝")
    expect(screen.getByRole("alert")).toHaveTextContent("PROVIDER_REJECTED · config.asr")
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "25")
    expect(screen.getByText("远端请求可能仍在执行，最终结果尚未确认。")).toBeInTheDocument()
    expect(screen.queryByLabelText("视频预览")).not.toBeInTheDocument()
  })

  it("查询暂时失败保留任务，后续查询恢复后清除读取错误", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
    const task: Task = testTask()
    mocks.fetch.mockResolvedValueOnce(jsonResponse(task)).mockResolvedValueOnce(jsonResponse({ error: {
      code: "INTERNAL_ERROR", message: "读取暂时失败", field: null, stage: null, action: "none",
    } }, 500)).mockImplementation(async () => jsonResponse({ ...task, status: "running", current_stage: "asr" }))
    await mount()
    expect(screen.getByRole("heading", { name: "示例.mp4" })).toBeInTheDocument()
    await act(async () => vi.advanceTimersByTimeAsync(2000))
    expect(screen.getByRole("alert")).toHaveTextContent("读取暂时失败")
    expect(screen.getByRole("heading", { name: "示例.mp4" })).toBeInTheDocument()
    await act(async () => vi.advanceTimersByTimeAsync(2000))
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    expect(screen.getByText("处理中")).toBeInTheDocument()
  })

  it("任务在其它窗口删除后清除旧产物与下载入口", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
    const base = `/api/v1/tasks/${testTask().id}/files/`
    const video: OutputFile = { url: base + "video", file_name: "video.mp4", mime_type: "video/mp4", size_bytes: 4096, duration_ms: 12000, timeline: "source" }
    const task = testTask({ status: "succeeded", current_stage: "done", finished_at: "2026-09-22T10:01:00.000Z", outputs: {
      video,
      source_subtitles: { ...video, url: base + "source_subtitles", file_name: "source.srt", mime_type: "application/x-subrip", duration_ms: null },
      translated_subtitles: { ...video, url: base + "translated_subtitles", file_name: "translated.srt", mime_type: "application/x-subrip", duration_ms: null },
    } })
    mocks.fetch.mockResolvedValueOnce(jsonResponse(task)).mockImplementation(async () => jsonResponse({ error: {
      code: "TASK_NOT_FOUND", message: "任务已不存在", field: null, stage: null, action: "none",
    } }, 404))
    await mount()
    expect(screen.getByLabelText("视频预览")).toBeInTheDocument()
    await act(async () => vi.advanceTimersByTimeAsync(2000))
    expect(screen.getByRole("alert")).toHaveTextContent("任务已不存在")
    expect(screen.queryByLabelText("视频预览")).not.toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "下载" })).not.toBeInTheDocument()
    expect(screen.queryByRole("heading", { name: "示例.mp4" })).not.toBeInTheDocument()
  })
})
