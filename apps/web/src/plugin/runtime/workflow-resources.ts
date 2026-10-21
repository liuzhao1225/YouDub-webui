import { createStore } from 'zustand/vanilla'
import type { Request } from './types'
import type { WorkflowDocument } from '../contracts'
import type { ResourceInventory, ResourcePreparation, ResourceSelection, SetupAction } from '@/runtime/setup-contracts'

export type ResourceState = {
  status: string; error?: string | { message?: string }
  requirements?: { providerId: string; model?: string; ready: boolean; automatic: boolean; reason?: string; configurationRequired?: boolean }[]
  environment?: { id: string; name: string; status: string; detail?: string }[]
  models?: { id: string; name: string; status: string; error?: string; received?: number; total?: number; speed?: number }[]
  activePreparation?: { status: string; error?: string }
}
type ResourceSnapshot = { result?: ResourceState; inventory?: ResourceInventory; inspection?: ResourcePreparation; error?: string; checking: boolean }
export type WorkflowResourcesResult = ResourceSnapshot & { ready: boolean; prepare(): void; check(): void }

/** Polling belongs to the view; preparation itself continues in SetupService after navigation. */
export class ResourcesController {
  private readonly state = createStore<ResourceSnapshot>(() => ({ checking: true }))
  private controller?: AbortController
  private timer?: ReturnType<typeof setTimeout>
  private subscribers = 0
  constructor(private readonly request: Request, private document?: WorkflowDocument, private readonly onReady: () => void = () => {}) {}
  getSnapshot = () => this.state.getState()
  setDocument(document: WorkflowDocument) { this.document = document }
  subscribe = (listener: () => void) => {
    const unsubscribe = this.state.subscribe(listener)
    if (++this.subscribers === 1) this.check()
    return () => { unsubscribe(); if (--this.subscribers === 0) this.stop() }
  }
  private stop() { this.controller?.abort(); if (this.timer) clearTimeout(this.timer); this.timer = undefined }
  check = () => this.document ? this.run('check') : this.runInventory()
  prepare = (selections?: ResourceSelection[]) => this.document ? this.run('prepare') : this.runInventory({ action: 'prepare', selections })
  action = (action: SetupAction, id?: string) => this.runInventory({ action, id })
  private runInventory(operation?: { action: SetupAction | 'prepare'; id?: string; selections?: ResourceSelection[] }) {
    this.stop()
    const controller = new AbortController()
    this.controller = controller
    this.state.setState({ checking: true, error: undefined })
    const current = () => this.controller === controller && !controller.signal.aborted
    const load = async (inspect: boolean) => {
      try {
        const previous = this.state.getState().inventory
        const inventory = await this.request<ResourceInventory>('/api/v2/resources', { signal: controller.signal })
        if (!current()) return
        this.state.setState({ inventory })
        if (inspect || (previous?.resources?.status === 'preparing' && inventory.resources?.status !== 'preparing')) {
          const selections = inventory.items.map(({ providerId, model }) => ({ providerId, ...(model ? { model } : {}) }))
          const inspection = await this.request<ResourcePreparation>('/api/v2/resources/check', { method: 'POST', body: JSON.stringify({ selections }), signal: controller.signal })
          if (!current()) return
          this.state.setState({ inspection, result: inspection })
        }
        this.state.setState({ checking: false })
        if (inventory.resources?.status === 'preparing') this.timer = setTimeout(() => void load(false), 1200)
      } catch (failure) {
        if (current()) this.state.setState({ checking: false, error: failure instanceof Error ? failure.message : String(failure) })
      }
    }
    void (async () => {
      if (operation) {
        try {
          await this.request(`/api/v2/resources/${operation.action === 'prepare' ? 'prepare' : 'action'}`, { method: 'POST',
            body: JSON.stringify(operation.action === 'prepare' ? { selections: operation.selections } : { action: operation.action, id: operation.id }), signal: controller.signal })
        } catch (failure) {
          if (current()) this.state.setState({ checking: false, error: failure instanceof Error ? failure.message : String(failure) })
          return
        }
        if (!current()) return
      }
      await load(true)
    })()
  }
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
export class WorkflowResourcesController extends ResourcesController {}
