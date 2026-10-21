import { createStore } from 'zustand/vanilla'
import type { Request } from './types'
import type { WorkflowDocumentRecord } from '../contracts'

export type QuerySnapshot<T> = { data: T | null; error: string }
export type QueryResult<T> = QuerySnapshot<T> & { refresh(): void }
export type QueryLoader<T> = (signal: AbortSignal) => Promise<T>

/** One subscribed resource owns its request, polling timer, cancellation, and failure. */
export class QueryResource<T> {
  private readonly state = createStore<QuerySnapshot<T>>(() => ({ data: null, error: '' }))
  private subscribers = 0
  private controller?: AbortController
  private timer?: ReturnType<typeof setTimeout>
  constructor(private readonly load: QueryLoader<T>, private readonly pollMs?: number) {}
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
        if (this.pollMs) this.timer = setTimeout(() => void run(), this.pollMs)
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
  query<T>(path: string, pollMs?: number) { return new QueryResource<T>((signal) => this.request<T>(path, { signal }), pollMs) }
  workflowDocuments() {
    return new QueryResource<{ items: WorkflowDocumentRecord[] }>(async (signal) => {
      const records = new Map<string, WorkflowDocumentRecord>()
      let offset = 0, more = true
      while (more) {
        const page = await this.request<{ items: WorkflowDocumentRecord[]; hasMore?: boolean; limit?: number }>(`/api/v2/workflow-documents?limit=100&offset=${offset}`, { signal })
        page.items.forEach((record) => records.set(record.id, record))
        more = page.hasMore === true
        offset += page.limit ?? 100
      }
      return { items: [...records.values()] }
    })
  }
}
