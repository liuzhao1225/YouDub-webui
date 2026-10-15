import { useCallback, useEffect, useState } from 'react'
import { useClient } from '../sdk'
export function useQuery<T>(path: string, pollMs?: number) {
  const client = useClient()
  const [result, setResult] = useState<{ path: string; data: T | null; error: string }>({ path, data: null, error: '' })
  const [revision, setRevision] = useState(0)
  const refresh = useCallback(() => setRevision((value) => value + 1), [])
  useEffect(() => {
    // Cordis returns a new service proxy on each property read. The owning
    // Context is stable, so a sibling query's render must not restart this one.
    const { apiClient } = client
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const run = async () => {
      try {
        const next = await apiClient.request<T>(path, { signal: controller.signal })
        if (!controller.signal.aborted) { setResult({ path, data: next, error: '' }); if (pollMs) timer = setTimeout(() => void run(), pollMs) }
      } catch (failure) {
        if (!controller.signal.aborted) setResult((current) => ({ path, data: current.path === path ? current.data : null, error: failure instanceof Error ? failure.message : String(failure) }))
      }
    }
    void run()
    return () => { controller.abort(); if (timer) clearTimeout(timer) }
  }, [client, path, pollMs, revision])
  return { data: result.path === path ? result.data : null, error: result.path === path ? result.error : '', refresh }
}
