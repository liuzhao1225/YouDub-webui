import type { SetupAction, SetupState } from '@/runtime/setup-contracts'
import { createStore, type StoreApi } from 'zustand/vanilla'
import type { Request } from '@/plugin/runtime/types'
import type { Catalog } from '@/plugin/contracts'
import { responseBody } from './http'

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

interface TranslationSnapshot { loaded: boolean; configured: boolean; ready: boolean; busy: boolean; error: string }

/** First run shares the same provider editor and availability rules as Settings. */
export class TranslationSetupController extends SnapshotStore<TranslationSnapshot> {
  private csrf = ''
  private controller: AbortController | null = null
  constructor() { super({ loaded: false, configured: false, ready: false, busy: false, error: '' }) }
  readonly request: Request = <T>(path: string, init?: RequestInit) => {
    if (!this.controller) return Promise.reject(new Error('Translation setup is closed.'))
    return this.api<T>(this.controller, path, init)
  }
  start = () => {
    this.stop()
    this.controller = new AbortController()
    this.update({ loaded: false, configured: false, ready: false, error: '', busy: false })
    void this.load(this.controller)
  }
  stop = () => { this.controller?.abort(); this.controller = null }
  setConfigured = (configured: boolean) => { if (this.controller) this.update({ configured }) }
  continue = () => { if (this.controller && this.snapshot.configured) this.update({ ready: true }) }
  private current(controller: AbortController) { return this.controller === controller && !controller.signal.aborted }
  private async api<T>(controller: AbortController, path: string, init?: RequestInit): Promise<T> {
    const headers = new Headers(init?.headers)
    if (init?.body) headers.set('Content-Type', 'application/json')
    if (init?.method && !['GET', 'HEAD'].includes(init.method.toUpperCase())) headers.set('X-CSRF-Token', this.csrf)
    const signal = init?.signal ? AbortSignal.any([controller.signal, init.signal]) : controller.signal
    const response = await fetch(path, { ...init, headers, signal, credentials: 'same-origin', cache: 'no-store' })
    return responseBody<T>(response)
  }
  private async load(controller: AbortController) {
    try {
      const session = await this.api<{ csrf_token: string }>(controller, '/api/auth/session')
      if (!this.current(controller)) return
      this.csrf = session.csrf_token
      const [settings, catalog] = await Promise.all([
        this.api<{ plugins?: Record<string, { translationDeferred?: boolean }> }>(controller, '/api/v2/settings'),
        this.api<Catalog>(controller, '/api/v2/catalog'),
      ])
      if (!this.current(controller)) return
      const configured = catalog.providers.some(provider => !provider.legacy && provider.available && provider.capability === 'translation')
      this.update({ loaded: true, configured, ready: configured || settings.plugins?.['youdub.onboarding']?.translationDeferred === true })
    } catch (failure) {
      if (this.current(controller)) this.update({ error: failure instanceof Error ? failure.message : String(failure) })
    }
  }
  skip = async () => {
    const controller = this.controller
    if (this.snapshot.busy || !this.snapshot.loaded || !controller) return
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
