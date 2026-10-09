import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { TaskCover } from "@/components/task-cover"
import { LanguageProvider } from "@/lib/i18n"

afterEach(() => cleanup())

describe("TaskCover", () => {
  it("同一任务始终得到同一张生成封面，不同任务配色不同", () => {
    render(
      <>
        <TaskCover id="8d129c98-8e49-4afb-af3a-0b4da4a5533f" />
        <TaskCover id="8d129c98-8e49-4afb-af3a-0b4da4a5533f" />
        <TaskCover id="4ddc069a-a889-4b78-9cc4-1f558875c370" />
      </>,
      { wrapper: LanguageProvider },
    )
    const [first, again, other] = screen.getAllByTestId("task-cover")
    expect(first.getAttribute("style")).toBe(again.getAttribute("style"))
    expect(first.getAttribute("style")).not.toBe(other.getAttribute("style"))
    expect(first.querySelector("img, video")).toBeNull()
  })

  it("小尺寸省略角标，并可关掉声波条", () => {
    render(<TaskCover id="task" size="sm" bars={false} />, { wrapper: LanguageProvider })
    const cover = screen.getByTestId("task-cover")
    expect(cover.querySelector("svg")).toBeNull()
    expect(cover.querySelectorAll("span")).toHaveLength(0)
  })

  it("加载封面图片，处理结束后停止前景动画且保留封面", () => {
    const { rerender } = render(<TaskCover id="task" src="/cover.jpg" processing />, { wrapper: LanguageProvider })
    const cover = screen.getByTestId("task-cover")
    const image = cover.querySelector("img")!
    expect(image).toHaveAttribute("src", "/cover.jpg")
    expect(cover.querySelector("video")).toBeNull()
    expect(cover.querySelectorAll(".animate-eq").length).toBeGreaterThan(0)
    fireEvent.load(image)
    expect(screen.queryByLabelText("正在加载封面")).not.toBeInTheDocument()
    rerender(<TaskCover id="task" src="/cover.jpg" />)
    expect(cover.querySelector("img")).toBe(image)
    expect(cover.querySelector(".animate-eq")).toBeNull()
  })

  it("封面加载失败时明确显示错误，新地址可以重新加载", () => {
    const { rerender } = render(<TaskCover id="task" src="/broken.jpg" />, { wrapper: LanguageProvider })
    fireEvent.error(screen.getByTestId("task-cover").querySelector("img")!)
    expect(screen.getByRole("status")).toHaveTextContent("封面加载失败")
    expect(screen.queryByLabelText("正在加载封面")).not.toBeInTheDocument()
    rerender(<TaskCover id="task" src="/new.jpg" />)
    expect(screen.queryByRole("status")).not.toBeInTheDocument()
    expect(screen.getByTestId("task-cover").querySelector("img")).toHaveAttribute("src", "/new.jpg")
  })
})
