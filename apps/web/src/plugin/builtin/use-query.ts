import { useCallback, useEffect, useState } from 'react'
import { useClient } from '../sdk'
export function useQuery<T>(path: string, pollMs?: number) {
  const { apiClient } = useClient()
  const [data, setData] = useState<T | null>(null), [error, setError] = useState(''), [revision, setRevision] = useState(0)
  const refresh = useCallback(() => setRevision((value) => value + 1), [])
  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const run = async () => {
      try {
        const next = await apiClient.request<T>(path, { signal: controller.signal })
        if (!controller.signal.aborted) { setData(next); setError(''); if (pollMs) timer = setTimeout(() => void run(), pollMs) }
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : String(failure))
      }
    }
    void run()
    return () => { controller.abort(); if (timer) clearTimeout(timer) }
  }, [apiClient, path, pollMs, revision])
  return { data, error, refresh }
}
