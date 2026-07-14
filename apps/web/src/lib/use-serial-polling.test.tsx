import { act, cleanup, render } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { type SerialPollingContext, useSerialPolling } from "@/lib/use-serial-polling"

function PollingProbe({ poll }: { poll: (context: SerialPollingContext) => Promise<void> }) {
  useSerialPolling(poll, 100)
  return null
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe("串行轮询生命周期", () => {
  it("上一轮完成前不重叠请求，卸载后取消请求和后续定时器", async () => {
    vi.useFakeTimers()

    const resolvers: Array<() => void> = []
    const signals: AbortSignal[] = []
    const poll = vi.fn(({ signal }: SerialPollingContext) => {
      signals.push(signal)
      return new Promise<void>((resolve) => {
        resolvers.push(resolve)
      })
    })

    const { unmount } = render(<PollingProbe poll={poll} />)
    await act(async () => Promise.resolve())
    expect(poll).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    expect(poll).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolvers[0]()
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(100)
    })
    expect(poll).toHaveBeenCalledTimes(2)

    unmount()
    expect(signals[1].aborted).toBe(true)

    await act(async () => {
      resolvers[1]()
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(500)
    })
    expect(poll).toHaveBeenCalledTimes(2)
  })
})
