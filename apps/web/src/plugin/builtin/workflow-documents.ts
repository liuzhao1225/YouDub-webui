import { useCallback, useEffect, useState } from 'react'
import { useClient, type WorkflowDocumentRecord } from '../sdk'

export function useWorkflowDocuments() {
  const client = useClient()
  const [data, setData] = useState<{ items: WorkflowDocumentRecord[] } | null>(null)
  const [error, setError] = useState(''), [revision, setRevision] = useState(0)
  const refresh = useCallback(() => setRevision((value) => value + 1), [])
  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      try {
        const records = new Map<string, WorkflowDocumentRecord>()
        let offset = 0, more = true
        while (more) {
          const page = await client.apiClient.request<{ items: WorkflowDocumentRecord[]; hasMore?: boolean; limit?: number }>('/api/v2/workflow-documents?limit=100&offset=' + offset, { signal: controller.signal })
          page.items.forEach((record) => records.set(record.id, record))
          more = page.hasMore === true
          offset += page.limit ?? 100
        }
        if (!controller.signal.aborted) { setData({ items: [...records.values()] }); setError('') }
      } catch (failure) { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : String(failure)) }
    }
    void load()
    return () => controller.abort()
  }, [client, revision])
  return { data, error, refresh }
}
