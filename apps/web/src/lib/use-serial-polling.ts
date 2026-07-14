"use client"

import { useCallback, useEffect, useRef } from "react"

export type SerialPollingContext = {
  signal: AbortSignal
  isCurrent: () => boolean
}

export function useSerialPolling(
  poll: (context: SerialPollingContext) => Promise<void>,
  delayMs = 2000,
) {
  const controllerRef = useRef<AbortController | null>(null)
  const generationRef = useRef(0)

  const invalidate = useCallback(() => {
    generationRef.current += 1
    controllerRef.current?.abort()
    controllerRef.current = null
  }, [])

  useEffect(() => {
    let disposed = false
    let timer: number | null = null

    const run = async () => {
      const generation = generationRef.current + 1
      generationRef.current = generation
      const controller = new AbortController()
      controllerRef.current = controller
      const isCurrent = () => (
        !disposed
        && !controller.signal.aborted
        && generation === generationRef.current
      )

      try {
        await poll({ signal: controller.signal, isCurrent })
      } finally {
        if (controllerRef.current === controller) controllerRef.current = null
        if (!disposed) timer = window.setTimeout(run, delayMs)
      }
    }

    void run()
    return () => {
      disposed = true
      invalidate()
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [delayMs, invalidate, poll])

  return invalidate
}
