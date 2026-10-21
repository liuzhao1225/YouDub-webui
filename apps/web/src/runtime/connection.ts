import { createStore } from 'zustand/vanilla'
import type { Request } from '@/plugin/runtime/types'

export type ConnectionRequest = Request
export interface Connection {
  adapter: string
  base_url: string
  model?: string | null
  has_api_key: boolean
  api_key_hint?: string | null
}
export interface ConnectionSettings {
  connections: Connection[]
  plugins?: Record<string, { translationDeferred?: boolean }>
}
export interface ConnectionDraft { url: string; model: string; key: string; clearKey: boolean }
export type ConnectionValidation = 'url' | 'model' | 'key'
export interface ConnectionSnapshot extends ConnectionDraft {
  settings: ConnectionSettings | null
  connection: Connection | null
  loaded: boolean
  loading: boolean
  busy: false | 'testing' | 'saving'
  dirty: boolean
  error: string
  validation: ConnectionValidation | null
  testedAt: string | null
  saved: boolean
  savedKey: boolean
  externalChange: boolean
  readbackFailed: boolean
}
const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error)

/** One connection draft. Transport owns authentication; this controller owns no React state. */
export class ConnectionController {
  private readonly store
  private controller: AbortController | null = null
  private baseline: Pick<ConnectionDraft, 'url' | 'model'>
  constructor(private request: ConnectionRequest, readonly adapter = 'openai') {
    this.baseline = { url: adapter === 'openai' ? 'https://api.openai.com/v1' : '', model: '' }
    this.store = createStore<ConnectionSnapshot>(() => ({
      ...this.baseline, key: '', clearKey: false, settings: null, connection: null,
      loaded: false, loading: false, busy: false, dirty: false, error: '', validation: null,
      testedAt: null, saved: false, savedKey: false, externalChange: false, readbackFailed: false,
    }))
  }
  getSnapshot = () => this.store.getState()
  subscribe = (listener: () => void) => this.store.subscribe(listener)
  private update(patch: Partial<ConnectionSnapshot>) { this.store.setState(patch) }
  private current(controller: AbortController) { return this.controller === controller && !controller.signal.aborted }
  private selection(settings: ConnectionSettings) { return settings.connections.find(item => item.adapter === this.adapter) ?? null }
  private applySettings(settings: ConnectionSettings, preserveDraft = false) {
    const connection = this.selection(settings)
    const values = { url: connection?.base_url ?? (this.adapter === 'openai' ? 'https://api.openai.com/v1' : ''), model: connection?.model ?? '' }
    if (preserveDraft && this.getSnapshot().dirty) {
      this.update({ settings, loaded: true, externalChange: JSON.stringify(connection) !== JSON.stringify(this.getSnapshot().connection) })
      return
    }
    this.baseline = values
    this.update({ settings, connection, ...values, key: '', clearKey: false, loaded: true, dirty: false,
      savedKey: Boolean(connection?.has_api_key), externalChange: false, readbackFailed: false })
  }
  start = () => this.load(false)
  private async load(discardDraft: boolean) {
    this.stop()
    const controller = this.controller = new AbortController()
    this.update({ loading: true, error: '', validation: null, busy: false })
    try {
      const settings = await this.request<ConnectionSettings>('/api/v2/settings', { signal: controller.signal })
      if (!this.current(controller)) return false
      if (JSON.stringify(this.selection(settings)) !== JSON.stringify(this.getSnapshot().connection)) this.update({ testedAt: null, saved: false })
      this.applySettings(settings, !discardDraft)
      return true
    } catch (error) {
      if (this.current(controller)) this.update({ error: errorMessage(error) })
      return false
    } finally { if (this.current(controller)) this.update({ loading: false }) }
  }
  stop = () => { this.controller?.abort(); this.controller = null }
  reload = async () => {
    if (this.getSnapshot().busy) return false
    const loaded = await this.load(true)
    if (loaded) this.update({ testedAt: null, saved: false })
    return loaded
  }
  change = (patch: Partial<ConnectionDraft>) => {
    const current = this.getSnapshot()
    if (current.busy || current.loading) return
    const next = { ...current, ...patch, ...(patch.clearKey === true ? { key: '' } : {}) }
    this.update({ ...patch, key: next.key, testedAt: null, saved: false, validation: null,
      dirty: next.url.trim() !== this.baseline.url || next.model.trim() !== this.baseline.model || Boolean(next.key.trim()) || next.clearKey,
      savedKey: !next.clearKey && Boolean(current.connection?.has_api_key) && current.connection?.base_url === next.url.trim() })
  }
  private validate(testing = false) {
    const { url, model, key, clearKey, savedKey } = this.getSnapshot()
    let validation: ConnectionValidation | null = null
    try {
      const parsed = new URL(url.trim())
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) validation = 'url'
    } catch { validation = 'url' }
    if (!validation && this.adapter === 'openai' && (testing || !clearKey)) {
      if (!model.trim()) validation = 'model'
      else if (clearKey || (!key.trim() && !savedKey)) validation = 'key'
    }
    this.update({ validation })
    return !validation
  }
  test = async () => {
    const controller = this.controller
    if (!controller || !this.getSnapshot().loaded || this.getSnapshot().busy || this.getSnapshot().loading) return false
    if (!this.validate(true)) return false
    const { url, model, key } = this.getSnapshot()
    this.update({ busy: 'testing', error: '', testedAt: null })
    try {
      await this.request('/api/v2/settings/test-connection', { method: 'POST', signal: controller.signal,
        body: JSON.stringify({ base_url: url.trim(), model: model.trim(), ...(key.trim() ? { api_key: key.trim() } : {}) }) })
      if (!this.current(controller)) return false
      this.update({ testedAt: new Date().toISOString() })
      return true
    } catch (error) {
      if (this.current(controller)) this.update({ error: errorMessage(error) })
      return false
    } finally { if (this.current(controller)) this.update({ busy: false }) }
  }
  save = async () => {
    const controller = this.controller
    if (!controller || !this.getSnapshot().loaded || this.getSnapshot().busy || this.getSnapshot().loading) return false
    if (!this.validate()) return false
    const { url, model, key, clearKey } = this.getSnapshot()
    this.update({ busy: 'saving', error: '', saved: false, readbackFailed: false })
    let written = false
    try {
      await this.request('/api/v2/settings', { method: 'PATCH', signal: controller.signal,
        body: JSON.stringify({ connection: { adapter: this.adapter, base_url: url.trim(),
          ...(this.adapter === 'openai' && model.trim() ? { model: model.trim() } : {}),
          ...(clearKey ? { api_key: null } : key.trim() ? { api_key: key.trim() } : {}) } }) })
      if (!this.current(controller)) return false
      written = true
      this.update({ key: '' })
      const settings = await this.request<ConnectionSettings>('/api/v2/settings', { signal: controller.signal })
      if (!this.current(controller)) return false
      this.applySettings(settings)
      this.update({ saved: true })
      return true
    } catch (error) {
      if (!this.current(controller)) return false
      this.update({ error: errorMessage(error), readbackFailed: written })
      if (error && typeof error === 'object' && 'code' in error && error.code === 'SETTINGS_PARTIALLY_APPLIED') {
        // Read the actual result after a reported partial write, keeping the original failure visible.
        try {
          const settings = await this.request<ConnectionSettings>('/api/v2/settings', { signal: controller.signal })
          if (this.current(controller)) { this.applySettings(settings); this.update({ testedAt: null }) }
        } catch (readError) {
          if (this.current(controller)) this.update({ error: `${errorMessage(error)}\n${errorMessage(readError)}` })
        }
      }
      return false
    } finally { if (this.current(controller)) this.update({ busy: false }) }
  }
}
