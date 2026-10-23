import { createStore } from '@/lib/store'
import type { JsonObject } from '@/plugin/sdk'
import type { InputFile } from '@/plugin/builtin/workflow-launch'
import type { Request } from '@/plugin/runtime/types'
import type { TaskView } from '@/plugin/contracts'

export type WorkflowRunDraft = { selectedFiles: InputFile[]; sourceUrl: string; proxyPort?: number; runtimeByDocument: Record<string, Record<string, JsonObject>> }
export type ComposerDraft = { files: Record<string, File>; sourceUrl: string; config: JsonObject }
export type Submission = { id: string; path: string; body: FormData | string; busy: boolean; error: string; failure?: unknown; task?: TaskView }
type StudioDraft = { selected: string; selectedGraph: string; draft: WorkflowRunDraft; overrides: Record<string, Record<string, JsonObject>>; composers: Record<string, ComposerDraft>; submissions: Record<string, Submission> }
const empty = (): StudioDraft => ({ selected: '', selectedGraph: '', draft: { selectedFiles: [], sourceUrl: '', runtimeByDocument: {} }, overrides: {}, composers: {}, submissions: {} })

/** Owned by the studio plugin so visiting settings retains File objects and task options. */
export class StudioDraftStore {
  private store = createStore<StudioDraft>(empty)
  getSnapshot = () => this.store.getState()
  subscribe = (listener: () => void) => this.store.subscribe(listener)
  set<K extends keyof StudioDraft>(key: K, next: StudioDraft[K] | ((current: StudioDraft[K]) => StudioDraft[K])) {
    this.store.setState(current => ({ [key]: typeof next === 'function' ? next(current[key]) : next }) as Pick<StudioDraft, K>)
  }
  clearSubmission(key: string) { this.set('submissions', current => { const next = { ...current }; delete next[key]; return next }) }
  clearGraph(id: string) {
    this.set('draft', current => { const runtimeByDocument = { ...current.runtimeByDocument }; delete runtimeByDocument[id]; return { selectedFiles: [], sourceUrl: '', runtimeByDocument } })
    this.set('overrides', current => { const next = { ...current }; delete next[id]; return next })
    this.clearSubmission(`graph:${id}`)
  }
  /** The accepted request and its ID outlive route components; retries reuse the exact body. */
  async submit(key: string, request: Request, body?: FormData | string, path = '/api/v2/tasks'): Promise<TaskView | undefined> {
    let submission = this.getSnapshot().submissions[key]
    if (submission?.busy) return
    if (!submission) {
      if (!body) throw new Error('Missing submission request')
      const frozen = typeof body === 'string' ? body : new FormData()
      if (typeof frozen !== 'string' && typeof body !== 'string') body.forEach((value, name) => frozen.append(name, value))
      const { id } = JSON.parse(typeof frozen === 'string' ? frozen : String(frozen.get('request'))) as { id: string }
      submission = { id, path, body: frozen, busy: false, error: '' }
      this.set('submissions', current => ({ ...current, [key]: submission! }))
    }
    if (submission.task) return submission.task
    return this.resolve(key, () => request<TaskView>(submission.path, { method: 'POST', body: submission.body }))
  }
  async check(key: string, request: Request) {
    const submission = this.getSnapshot().submissions[key]
    if (!submission || submission.busy) return
    return submission.task ?? this.resolve(key, () => request<TaskView>(`/api/v2/tasks/${submission.id}`))
  }
  async discard(key: string, request: Request) {
    const submission = this.getSnapshot().submissions[key]
    if (!submission || submission.busy) return false
    const result = await this.resolve(key, async () => { await request(`/api/v2/imports/${submission.id}`, { method: 'DELETE' }); return true })
    if (result) this.clearSubmission(key)
    return !!result
  }
  private async resolve<T>(key: string, action: () => Promise<T>): Promise<T | undefined> {
    this.set('submissions', current => ({ ...current, [key]: { ...current[key], busy: true, error: '', failure: undefined } }))
    try {
      const result = await action()
      this.set('submissions', current => current[key] ? ({ ...current, [key]: { ...current[key], busy: false, ...(typeof result === 'object' && result !== null ? { task: result as unknown as TaskView } : {}) } }) : current)
      return result
    } catch (failure) {
      this.set('submissions', current => current[key] ? ({ ...current, [key]: { ...current[key], busy: false, failure, error: failure instanceof Error ? failure.message : String(failure) } }) : current)
      return undefined
    }
  }
  reset = () => this.store.setState(empty(), true)
}
