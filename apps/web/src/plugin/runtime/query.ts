import { createStore } from '@/lib/store'
import type { Request } from './types'
import type { Diagnostic, WorkflowDocumentRecord } from '../contracts'

export type WorkflowDocuments = { items: WorkflowDocumentRecord[]; legacyDefaultsMigration?: { status: 'blocked'; diagnostics: Diagnostic[] } | { status: 'complete'; documentId: string; revision: number } | null }

export type QuerySnapshot<T> = { data: T | null; error: string }
export type QueryResult<T> = QuerySnapshot<T> & { refresh(): void }
export type QueryLoader<T> = (signal: AbortSignal) => Promise<T>
export function taskNeedsPolling(task: { status: string }) { return !['succeeded', 'failed', 'cancelled'].includes(task.status) }

/** One subscribed resource owns its request, polling timer, cancellation, and failure. */
export class QueryResource<T> {
  private readonly state = createStore<QuerySnapshot<T>>(() => ({ data: null, error: '' }))
  private subscribers = 0
  private controller?: AbortController
  private timer?: ReturnType<typeof setTimeout>
  constructor(private readonly load: QueryLoader<T>, private readonly pollMs?: number, private readonly shouldPoll?: (value: T) => boolean) {}
  getSnapshot = () => this.state.getState()
  subscribe = (listener: () => void) => {
    const unsubscribe = this.state.subscribe(listener)
    if (++this.subscribers === 1) this.refresh()
    return () => { unsubscribe(); if (--this.subscribers === 0) this.stop() }
  }
  private stop() { this.controller?.abort(); if (this.timer) clearTimeout(this.timer); this.timer = undefined }
  refresh = () => {
    this.stop()
    if (!this.subscribers) return
    const controller = new AbortController()
    this.controller = controller
    const run = async () => {
      try {
        const data = await this.load(controller.signal)
        if (controller.signal.aborted) return
        this.state.setState({ data, error: '' }, true)
        if (this.pollMs && (!this.shouldPoll || this.shouldPoll(data))) this.timer = setTimeout(() => void run(), this.pollMs)
      } catch (failure) {
        if (!controller.signal.aborted) this.state.setState({ error: failure instanceof Error ? failure.message : String(failure) })
      }
    }
    void run()
  }
}

/** Transport-bound resource factory; no rendering state or component subscriptions. */
export class QueryClient {
  constructor(private readonly request: Request) {}
  query<T>(path: string, pollMs?: number, shouldPoll?: (value: T) => boolean) { return new QueryResource<T>((signal) => this.request<T>(path, { signal }), pollMs, shouldPoll) }
  workflowDocuments() {
    return new QueryResource<WorkflowDocuments>(async (signal) => {
      const records = new Map<string, WorkflowDocumentRecord>()
      let legacyDefaultsMigration: WorkflowDocuments['legacyDefaultsMigration']
      let offset = 0, more = true
      while (more) {
        const page = await this.request<WorkflowDocuments & { hasMore?: boolean; limit?: number }>(`/api/v2/workflow-documents?limit=100&offset=${offset}`, { signal })
        if (offset === 0) legacyDefaultsMigration = page.legacyDefaultsMigration
        page.items.forEach((record) => records.set(record.id, record))
        more = page.hasMore === true
        offset += page.limit ?? 100
      }
      return { items: [...records.values()], ...(legacyDefaultsMigration ? { legacyDefaultsMigration } : {}) }
    })
  }
}
