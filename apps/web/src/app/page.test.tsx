import { cleanup, render, screen, waitFor } from "@testing-library/react"
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
