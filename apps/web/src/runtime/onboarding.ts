import type { SetupAction, SetupState } from '@/components/setup-screen'
import type { Runtime, TaskConfig } from '@/plugin/builtin/localize-contracts'
import { createStore, type StoreApi } from 'zustand/vanilla'

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

type Settings = { connections: { adapter: string; base_url: string; has_api_key: boolean; api_key_hint?: string | null }[]; defaults?: TaskConfig | null; plugins?: Record<string, { translationDeferred?: boolean }> }
type TranslationDraft = { url: string; model: string; key: string }
interface TranslationSnapshot extends TranslationDraft { settings: Settings | null; ready: boolean; busy: boolean; error: string }

/** Tests and saves first-run translation settings before opening the workbench. */
export class TranslationSetupController extends SnapshotStore<TranslationSnapshot> {
  private csrf = ''
  private controller: AbortController | null = null
  constructor() { super({ settings: null, url: 'https://api.openai.com/v1', model: '', key: '', ready: false, busy: false, error: '' }) }
  start = () => {
    this.stop()
    this.controller = new AbortController()
    this.update({ error: '', busy: false })
    void this.load(this.controller)
  }
  stop = () => { this.controller?.abort(); this.controller = null }
  change = (patch: Partial<TranslationDraft>) => { this.update(patch) }
  private current(controller: AbortController) { return this.controller === controller && !controller.signal.aborted }
  private async api<T>(controller: AbortController, path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(path, { ...init, signal: controller.signal, credentials: 'same-origin', cache: 'no-store' })
    const body = await response.json()
    if (!response.ok) throw new Error(body.error?.message || body.detail || `请求失败（HTTP ${response.status}）`)
    return body
  }
  private mutate(controller: AbortController, path: string, body: unknown, method = 'PATCH') {
    return this.api(controller, path, { method, headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': this.csrf }, body: JSON.stringify(body) })
  }
  private async load(controller: AbortController) {
    try {
      const session = await this.api<{ csrf_token: string }>(controller, '/api/auth/session')
      if (!this.current(controller)) return
      const settings = await this.api<Settings>(controller, '/api/v2/settings')
      if (!this.current(controller)) return
      this.csrf = session.csrf_token
      const connection = settings.connections.find(item => item.adapter === 'openai')
      const model = settings.defaults?.translation?.model
      this.update({ settings, ...(connection ? { url: connection.base_url } : {}), ...(model ? { model } : {}),
        ready: Boolean(connection?.has_api_key && model) || settings.plugins?.['youdub.onboarding']?.translationDeferred === true })
    } catch (failure) {
      if (this.current(controller)) this.update({ error: failure instanceof Error ? failure.message : String(failure) })
    }
  }
  save = async () => {
    const { settings, url, model, key, busy } = this.snapshot
    const controller = this.controller
    if (busy || !settings || !controller) return
    this.update({ busy: true, error: '' })
    try {
      await this.mutate(controller, '/api/v2/settings/test-connection', { base_url: url.trim(), model: model.trim(), ...(key.trim() ? { api_key: key.trim() } : {}) }, 'POST')
      if (!this.current(controller)) return
      const runtime = await this.api<Runtime>(controller, '/api/v2/runtime')
      if (!this.current(controller)) return
      const provider = runtime.capabilities.find(item => item.capability === 'asr' && item.models.length)
      const asr = provider?.models[0]
      // Whisper tiny is the subtitle workflow's default before ASR installation.
      const asrSelection = settings.defaults?.asr ?? (provider && asr
        ? { adapter: provider.adapter, model: asr.id, device: asr.devices[0] }
        : { adapter: 'whisper', model: 'tiny', device: 'cpu' })
      await this.mutate(controller, '/api/v2/settings', { connection: { adapter: 'openai', base_url: url.trim(), ...(key.trim() ? { api_key: key.trim() } : {}) } })
      if (!this.current(controller)) return
      this.update({ key: '' })
      await this.mutate(controller, '/api/v2/settings', { defaults: { source_language: 'auto', target_language: 'zh', output_mode: 'subtitles', keep_background: false,
        asr: asrSelection, tts: null, separation: null, ...settings.defaults, translation: { adapter: 'openai', model: model.trim(), device: 'remote' } } })
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
      await this.mutate(controller, '/api/v2/settings', { plugin: { id: 'youdub.onboarding', config: { translationDeferred: true } } })
      if (this.current(controller)) this.update({ ready: true })
    } catch (failure) {
      if (this.current(controller)) this.update({ error: failure instanceof Error ? failure.message : String(failure) })
    } finally {
      if (this.current(controller)) this.update({ busy: false })
    }
  }
}
