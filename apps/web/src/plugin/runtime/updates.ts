import { createStore } from 'zustand/vanilla'
import type { Request } from './types'
export type UpdateInfo = { currentVersion: string; automatic: boolean; supported: boolean }
export type UpdateResult = { checkedAt: string; available: { version: string; url: string; download: string; checksum: string } | null }
export type UpdateState = { info: UpdateInfo | null; result: UpdateResult | null; busy: boolean; error: string }
export type Updates = UpdateState & { check(): void; setAutomatic(value: boolean): void }
const HOUR = 60 * 60 * 1000

export class UpdatesController {
  private readonly state = createStore<UpdateState>(() => ({ info: null, result: null, busy: true, error: '' }))
  private pending?: AbortController
  private timer?: ReturnType<typeof setTimeout>
  private subscribers = 0
  constructor(private readonly request: Request) {}
  getSnapshot = () => this.state.getState()
  subscribe = (listener: () => void) => {
    const unsubscribe = this.state.subscribe(listener)
    if (++this.subscribers === 1) void this.run()
    return () => { unsubscribe(); if (--this.subscribers === 0) { clearTimeout(this.timer); this.pending?.abort(); this.pending = undefined } }
  }
  check = () => { void this.run(true) }
  setAutomatic = (automatic: boolean) => { void this.run(false, automatic) }
  private async run(manual = false, automatic?: boolean) {
    if (this.pending) return
    clearTimeout(this.timer)
    const controller = new AbortController()
    this.pending = controller
    this.state.setState({ busy: true, error: '' })
    try {
      if (automatic !== undefined) await this.request('/api/v2/settings', { method: 'PATCH', signal: controller.signal, body: JSON.stringify({ plugin: { id: 'youdub.updates', config: { automatic } } }) })
      const info = await this.request<UpdateInfo>('/api/v2/updates', { signal: controller.signal })
      if (controller.signal.aborted) return
      this.state.setState({ info })
      if (info.supported && (manual || info.automatic)) {
        const result = await this.request<UpdateResult>('/api/v2/updates/check', { method: 'POST', signal: controller.signal })
        if (controller.signal.aborted) return
        this.state.setState({ result })
      }
      if (info.supported && info.automatic) this.timer = setTimeout(() => void this.run(), HOUR)
    } catch (failure) {
      if (!controller.signal.aborted) this.state.setState({ result: null, error: failure instanceof Error ? failure.message : String(failure) })
    } finally {
      if (this.pending === controller) this.pending = undefined
      if (!controller.signal.aborted) this.state.setState({ busy: false })
    }
  }
}
