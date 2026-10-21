import { createStore } from 'zustand/vanilla'
import type { JsonObject } from '@/plugin/sdk'
import type { InputFile } from '@/plugin/builtin/workflow-launch'

export type WorkflowRunDraft = { selectedFiles: InputFile[]; sourceUrl: string; runtimeByDocument: Record<string, Record<string, JsonObject>> }
export type ComposerDraft = { files: Record<string, File>; sourceUrl: string; config: JsonObject }
type StudioDraft = { selected: string; selectedGraph: string; draft: WorkflowRunDraft; overrides: Record<string, Record<string, JsonObject>>; composers: Record<string, ComposerDraft> }
const empty = (): StudioDraft => ({ selected: '', selectedGraph: '', draft: { selectedFiles: [], sourceUrl: '', runtimeByDocument: {} }, overrides: {}, composers: {} })

/** Owned by the studio plugin so visiting settings retains File objects and task options. */
export class StudioDraftStore {
  private store = createStore<StudioDraft>(empty)
  getSnapshot = () => this.store.getState()
  subscribe = (listener: () => void) => this.store.subscribe(listener)
  set<K extends keyof StudioDraft>(key: K, next: StudioDraft[K] | ((current: StudioDraft[K]) => StudioDraft[K])) {
    this.store.setState(current => ({ [key]: typeof next === 'function' ? next(current[key]) : next }) as Pick<StudioDraft, K>)
  }
  reset = () => this.store.setState(empty(), true)
}
