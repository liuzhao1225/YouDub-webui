import type { SetupAction, SetupState } from '@/runtime/setup-contracts'
import { createStore, type StoreApi } from 'zustand/vanilla'
import { ConnectionController, type ConnectionDraft, type ConnectionSettings } from './connection'

class SnapshotStore<T extends object> {
  private readonly store: StoreApi<T>
  constructor(initial: T) { this.store = createStore<T>(() => initial) }
  protected get snapshot() { return this.store.getState() }
  getSnapshot = () => this.store.getState()
  subscribe = (listener: () => void) => this.store.subscribe(listener)
  protected update(patch: Partial<T>) { this.store.setState(patch) }
}

interface SetupSnapshot { state: SetupState | null; error: string; busy: boolean }

/** Owns setup requests and polling for the mounted preparation gate. */
export class SetupController extends SnapshotStore<SetupSnapshot> {
  private controller: AbortController | null = null
  private timer: ReturnType<typeof setTimeout> | undefined
  constructor() { super({ state: null, error: '', busy: false }) }
  start = () => {
    this.stop()
    this.controller = new AbortController()
    this.update({ error: '', busy: false })
    void this.poll(this.controller)
  }
  stop = () => {
    this.controller?.abort()
    this.controller = null
    clearTimeout(this.timer)
  }
  private current(controller: AbortController) { return this.controller === controller && !controller.signal.aborted }
  private async request(controller: AbortController, init?: RequestInit): Promise<SetupState> {
    const response = await fetch('/api/setup', { ...init, signal: controller.signal, cache: 'no-store', credentials: 'same-origin' })
    const body = await response.text()
    if (!response.ok) throw new Error(`环境准备请求失败 (${response.status})：${body}`)
    return JSON.parse(body)
  }
  private async poll(controller: AbortController) {
    try {
      const state = await this.request(controller)
      if (!this.current(controller)) return
      this.update({ state })
      if (state.phase !== 'ready' && !this.snapshot.error) this.timer = setTimeout(() => void this.poll(controller), 800)
    } catch (failure) {
      if (this.current(controller)) this.update({ error: failure instanceof Error ? failure.message : String(failure) })
    }
  }
  action = async (action: SetupAction, id?: string) => {
    const { state, busy } = this.snapshot
    const controller = this.controller
    if (!state || busy || !controller) return
    this.update({ busy: true })
    try {
      const next = await this.request(controller, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-YouDub-Setup': state.token }, body: JSON.stringify({ action, id }) })
      if (this.current(controller)) this.update({ state: next })
    } catch (failure) {
      if (this.current(controller)) {
        clearTimeout(this.timer)
        this.update({ error: failure instanceof Error ? failure.message : String(failure) })
      }
    } finally {
      if (this.current(controller)) this.update({ busy: false })
    }
  }
}

interface TranslationSnapshot { settings: ConnectionSettings | null; ready: boolean; busy: boolean; error: string }

/** Tests and saves first-run translation settings before opening the workbench. */
export class TranslationSetupController extends SnapshotStore<TranslationSnapshot> {
  readonly connection: ConnectionController
  private csrf = ''
  private controller: AbortController | null = null
  constructor() {
    super({ settings: null, ready: false, busy: false, error: '' })
    this.connection = new ConnectionController(async <T>(path: string, init?: RequestInit) => {
      const controller = this.controller
      if (!controller) throw new Error('Translation setup is closed.')
      return this.api<T>(controller, path, init)
    })
  }
  start = () => {
    this.stop()
    this.controller = new AbortController()
    this.update({ settings: null, ready: false, error: '', busy: false })
    void this.load(this.controller)
  }
  stop = () => { this.controller?.abort(); this.controller = null; this.connection.stop() }
  change = (patch: Partial<ConnectionDraft>) => { this.connection.change(patch) }
  private current(controller: AbortController) { return this.controller === controller && !controller.signal.aborted }
  private async api<T>(controller: AbortController, path: string, init?: RequestInit): Promise<T> {
    const headers = new Headers(init?.headers)
    if (init?.body) headers.set('Content-Type', 'application/json')
    if (init?.method && !['GET', 'HEAD'].includes(init.method.toUpperCase())) headers.set('X-CSRF-Token', this.csrf)
    const signal = init?.signal ? AbortSignal.any([controller.signal, init.signal]) : controller.signal
    const response = await fetch(path, { ...init, headers, signal, credentials: 'same-origin', cache: 'no-store' })
    const body = await response.json()
    if (!response.ok) throw Object.assign(new Error(body.error?.message || body.detail || `HTTP ${response.status}`), { code: body.error?.code })
    return body
  }
  private async load(controller: AbortController) {
    try {
      const session = await this.api<{ csrf_token: string }>(controller, '/api/auth/session')
      if (!this.current(controller)) return
      this.csrf = session.csrf_token
      if (!await this.connection.start() || !this.current(controller)) {
        if (this.current(controller)) this.update({ error: this.connection.getSnapshot().error })
        return
      }
      const settings = this.connection.getSnapshot().settings!
      const connection = settings.connections.find(item => item.adapter === 'openai')
      this.update({ settings, ready: Boolean(connection?.has_api_key && connection.model?.trim()) || settings.plugins?.['youdub.onboarding']?.translationDeferred === true })
    } catch (failure) {
      if (this.current(controller)) this.update({ error: failure instanceof Error ? failure.message : String(failure) })
    }
  }
  save = async () => {
    const controller = this.controller
    if (this.snapshot.busy || !this.snapshot.settings || !controller) return
    this.update({ busy: true, error: '' })
    try {
      if (!await this.connection.test() || !this.current(controller)) return
      if (!await this.connection.save() || !this.current(controller)) return
      if (this.current(controller)) this.update({ ready: true })
    } catch (failure) {
      if (this.current(controller)) this.update({ error: failure instanceof Error ? failure.message : String(failure) })
    } finally {
      if (this.current(controller)) this.update({ busy: false })
    }
  }
  skip = async () => {
    const controller = this.controller
    if (this.snapshot.busy || !this.snapshot.settings || !controller) return
    this.update({ busy: true, error: '' })
    try {
      await this.api(controller, '/api/v2/settings', { method: 'PATCH', body: JSON.stringify({ plugin: { id: 'youdub.onboarding', config: { translationDeferred: true } } }) })
      if (this.current(controller)) this.update({ ready: true })
    } catch (failure) {
      if (this.current(controller)) this.update({ error: failure instanceof Error ? failure.message : String(failure) })
    } finally {
      if (this.current(controller)) this.update({ busy: false })
    }
  }
}
