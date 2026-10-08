import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { TaskCover } from "@/components/task-cover"

afterEach(() => cleanup())

describe("TaskCover", () => {
  it("同一任务始终得到同一张生成封面，不同任务配色不同", () => {
    render(
      <>
        <TaskCover id="8d129c98-8e49-4afb-af3a-0b4da4a5533f" />
        <TaskCover id="8d129c98-8e49-4afb-af3a-0b4da4a5533f" />
        <TaskCover id="4ddc069a-a889-4b78-9cc4-1f558875c370" />
      </>,
    )
    const [first, again, other] = screen.getAllByTestId("task-cover")
    expect(first.getAttribute("style")).toBe(again.getAttribute("style"))
    expect(first.getAttribute("style")).not.toBe(other.getAttribute("style"))
    expect(first.querySelector("img, video")).toBeNull()
  })

  it("小尺寸省略角标，并可关掉声波条", () => {
    render(<TaskCover id="task" size="sm" bars={false} />)
    const cover = screen.getByTestId("task-cover")
    expect(cover.querySelector("svg")).toBeNull()
    expect(cover.querySelectorAll("span")).toHaveLength(0)
  })
})
