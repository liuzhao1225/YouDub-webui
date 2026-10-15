import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { VideoPlayer } from "@/components/video-player"
import { LanguageProvider } from "@/lib/i18n"

// jsdom 没有实现媒体播放和全屏，这里只验证播放器把操作正确转给了 video 元素。
beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (this: HTMLMediaElement) {
    fireEvent.play(this)
    return Promise.resolve()
  })
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function (this: HTMLMediaElement) {
    fireEvent.pause(this)
  })
})

afterEach(() => {
  cleanup()
  window.localStorage.clear()
  vi.restoreAllMocks()
  Reflect.deleteProperty(HTMLElement.prototype, "requestFullscreen")
})

function renderPlayer() {
  render(
    <LanguageProvider>
      <VideoPlayer src="/api/tasks/task-a/artifact/final-video" />
    </LanguageProvider>,
  )
  const player = screen.getByRole("region", { name: "视频播放器" })
  const video = player.querySelector("video") as HTMLVideoElement
  return { player, video }
}

describe("成品视频播放器", () => {
  it("支持倍速、静音和全屏", async () => {
    const user = userEvent.setup()
    const requestFullscreen = vi.fn(() => Promise.resolve())
    Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
      configurable: true,
      value: requestFullscreen,
    })
    const { player, video } = renderPlayer()
    expect(video).toHaveAttribute("src", "/api/tasks/task-a/artifact/final-video")

    await user.click(within(player).getByRole("button", { name: "倍速" }))
    const menu = within(player).getByRole("menu", { name: "倍速" })
    expect(within(menu).getAllByRole("menuitemradio").map((item) => item.textContent)).toEqual([
      "0.5x",
      "0.75x",
      "1x",
      "1.25x",
      "1.5x",
      "2x",
    ])
    await user.click(within(menu).getByRole("menuitemradio", { name: "1.5x" }))
    fireEvent.rateChange(video)
    expect(video.playbackRate).toBe(1.5)
    expect(within(player).getByRole("button", { name: "倍速" })).toHaveTextContent("1.5x")
    expect(within(player).queryByRole("menu")).not.toBeInTheDocument()

    await user.click(within(player).getByRole("button", { name: "静音" }))
    fireEvent.volumeChange(video)
    expect(video.muted).toBe(true)
    await user.click(within(player).getByRole("button", { name: "取消静音" }))
    fireEvent.volumeChange(video)
    expect(video.muted).toBe(false)

    await user.click(within(player).getByRole("button", { name: "全屏" }))
    expect(requestFullscreen).toHaveBeenCalledTimes(1)
    expect(requestFullscreen.mock.contexts[0]).toBe(player)
  })

  it("播放器聚焦时支持键盘快捷键", async () => {
    const user = userEvent.setup()
    const { player, video } = renderPlayer()

    player.focus()
    await user.keyboard("k")
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1)
    expect(within(player).getAllByRole("button", { name: "暂停" }).length).toBeGreaterThan(0)

    await user.keyboard("m")
    expect(video.muted).toBe(true)
    await user.keyboard("m")
    expect(video.muted).toBe(false)
  })
})
