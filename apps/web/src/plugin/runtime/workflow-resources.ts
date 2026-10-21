import { createStore } from 'zustand/vanilla'
import type { Request } from './types'
import type { WorkflowDocument } from '../contracts'

export type ResourceState = {
  status: string; error?: string | { message?: string }
  requirements?: { providerId: string; model?: string; ready: boolean; automatic: boolean; reason?: string; configurationRequired?: boolean }[]
  environment?: { id: string; name: string; status: string; detail?: string }[]
  models?: { id: string; name: string; status: string; error?: string; received?: number; total?: number; speed?: number }[]
  activePreparation?: { status: string; error?: string }
}
type ResourceSnapshot = { result?: ResourceState; error?: string; checking: boolean }
export type WorkflowResourcesResult = ResourceSnapshot & { ready: boolean; prepare(): void; check(): void }

/** Resource preparation continues only while its owner is subscribed; a failure stops polling. */
export class WorkflowResourcesController {
  private readonly state = createStore<ResourceSnapshot>(() => ({ checking: true }))
  private controller?: AbortController
  private timer?: ReturnType<typeof setTimeout>
  private subscribers = 0
  constructor(private readonly request: Request, private document: WorkflowDocument, private readonly onReady: () => void) {}
  getSnapshot = () => this.state.getState()
  setDocument(document: WorkflowDocument) { this.document = document }
  subscribe = (listener: () => void) => {
    const unsubscribe = this.state.subscribe(listener)
    if (++this.subscribers === 1) this.check()
    return () => { unsubscribe(); if (--this.subscribers === 0) this.stop() }
  }
  private stop() { this.controller?.abort(); if (this.timer) clearTimeout(this.timer); this.timer = undefined }
  check = () => this.run('check')
  prepare = () => this.run('prepare')
  private run(action: 'check' | 'prepare') {
    this.stop()
    const controller = new AbortController()
    this.controller = controller
    const load = async (nextAction: 'check' | 'prepare') => {
      this.state.setState({ checking: true, error: undefined })
      try {
        const result = await this.request<ResourceState>(`/api/v2/workflow-documents/resources/${nextAction}`, { method: 'POST', body: JSON.stringify({ document: this.document }), signal: controller.signal })
        if (controller.signal.aborted) return
        this.state.setState({ result, checking: false }, true)
        if (result.status === 'ready') this.onReady()
        if (result.status === 'preparing' || result.activePreparation?.status === 'preparing') this.timer = setTimeout(() => void load('check'), 1200)
      } catch (failure) {
        if (!controller.signal.aborted) this.state.setState({ checking: false, error: failure instanceof Error ? failure.message : String(failure) })
      }
    }
    void load(action)
  }
}
