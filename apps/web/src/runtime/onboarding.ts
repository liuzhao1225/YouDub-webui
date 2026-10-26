import type { ResourceSelection, SetupAction, SetupState } from '@/runtime/setup-contracts'
import { createStore, type StoreApi } from '@/lib/store'
import type { Request } from '@/plugin/runtime/types'
import type { Catalog } from '@/plugin/contracts'

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
  private mutationRevision = 0
  constructor(private readonly api: Request) { super({ state: null, error: '', busy: false }) }
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
    return this.api<SetupState>('/api/setup', { ...init, signal: controller.signal })
  }
  private async poll(controller: AbortController) {
    const revision = this.mutationRevision
    try {
      const state = await this.request(controller)
      if (!this.current(controller)) return
      // A read started before an applied action cannot restore its old state.
      if (revision === this.mutationRevision && !this.snapshot.busy) this.update({ state })
      if (this.snapshot.state?.phase !== 'ready' && !this.snapshot.error) this.timer = setTimeout(() => void this.poll(controller), 800)
    } catch (failure) {
      if (this.current(controller)) this.update({ error: failure instanceof Error ? failure.message : String(failure) })
    }
  }
  action = (action: SetupAction, id?: string) => this.mutate({ action, id })
  configure = (path: string) => this.mutate({ action: 'configure', path })
  prepare = (selections: ResourceSelection[]) => this.mutate({ action: 'prepare', selections })
  private async mutate(body: { action: SetupAction; id?: string } | { action: 'prepare'; selections: ResourceSelection[] } | { action: 'configure'; path: string }) {
    const { state, busy } = this.snapshot
    const controller = this.controller
    if (!state || busy || !controller) return
    this.update({ busy: true })
    try {
      const next = await this.request(controller, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (this.current(controller)) { this.mutationRevision++; this.update({ state: next }) }
    } catch (failure) {
      if (this.current(controller)) {
        // Directory submission errors belong to the form that can correct them.
        if (body.action === 'configure') throw failure
        clearTimeout(this.timer)
        this.update({ error: failure instanceof Error ? failure.message : String(failure) })
      }
    } finally {
      if (this.current(controller)) this.update({ busy: false })
    }
  }
}

interface TranslationSnapshot { loaded: boolean; configured: boolean; ready: boolean; busy: boolean; error: string }

function translationAvailability(catalog: Catalog) {
  const providers = catalog.providers.filter(provider => !provider.legacy && provider.capability === 'translation')
  const configured = providers.some(provider => provider.available)
  const error = configured ? '' : providers.filter(provider => provider.unavailableReason)
    .map(provider => `${provider.label}: ${provider.unavailableReason}`).join('\n')
  return { configured, error }
}

/** First run shares the same provider editor and availability rules as Settings. */
export class TranslationSetupController extends SnapshotStore<TranslationSnapshot> {
  private controller: AbortController | null = null
  constructor(private readonly suppliedRequest: Request) { super({ loaded: false, configured: false, ready: false, busy: false, error: '' }) }
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
  refreshConfigured = async () => {
    const controller = this.controller
    if (!controller) return
    try {
      const catalog = await this.api<Catalog>(controller, '/api/v2/catalog')
      if (this.current(controller)) this.update(translationAvailability(catalog))
    } catch (failure) {
      if (this.current(controller)) this.update({ configured: false, error: failure instanceof Error ? failure.message : String(failure) })
    }
  }
  continue = () => { if (this.controller && this.snapshot.configured) this.update({ ready: true }) }
  private current(controller: AbortController) { return this.controller === controller && !controller.signal.aborted }
  private async api<T>(controller: AbortController, path: string, init?: RequestInit): Promise<T> {
    const signal = init?.signal ? AbortSignal.any([controller.signal, init.signal]) : controller.signal
    return this.suppliedRequest<T>(path, { ...init, signal })
  }

  private async load(controller: AbortController) {
    try {
      const [settings, catalog] = await Promise.all([
        this.api<{ plugins?: Record<string, { translationDeferred?: boolean }> }>(controller, '/api/v2/settings'),
        this.api<Catalog>(controller, '/api/v2/catalog'),
      ])
      if (!this.current(controller)) return
      const availability = translationAvailability(catalog)
      this.update({ loaded: true, ...availability, ready: availability.configured || settings.plugins?.['youdub.onboarding']?.translationDeferred === true })
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
