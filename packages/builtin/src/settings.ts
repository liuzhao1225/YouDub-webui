import { Service, type Context } from 'cordis'
import { AppError, type SettingsService, type TaskRecord, type JsonObject } from '@youdub/sdk'

export default class Settings extends Service implements SettingsService {
  static inject = ['store', 'catalog', 'secrets']
  private lock = Promise.resolve()
  constructor(ctx: Context) { super(ctx, 'settings') }
  async locked<T>(action: () => Promise<T>): Promise<T> {
    const previous = this.lock
    let release!: () => void
    this.lock = new Promise(resolve => { release = resolve })
    await previous
    try { return await action() } finally { release() }
  }
  read() { return this.ctx.store.call('settings.get') }
  patch(patch: JsonObject) { return this.locked(async () => {
    const saved = await this.ctx.store.call('settings.patch', { patch })
    this.ctx.emit('settings/updated', saved)
    await this.ctx.catalog.refresh()
    return saved
  }) }
  async runtime() {
    await this.ctx.catalog.refresh()
    const runtime = await this.ctx.store.call('runtime.get')
    const providers = this.ctx.catalog.describe().providers.filter(item => item.capability)
    runtime.capabilities = providers.map(provider => ({
      adapter: provider.adapter ?? provider.id, capability: provider.capability, execution: provider.execution,
      available: provider.available ?? false, unavailable_reason: provider.unavailableReason ?? null,
      requires_api_key: provider.execution === 'remote', models: provider.models ?? [],
      data_sent: provider.dataSent ?? [], remote_operations: provider.remoteOperations ?? null,
    }))
    runtime.status = runtime.capabilities.filter((item: any) => item.capability !== 'subtitle_alignment').every((item: any) => item.available) ? 'ready' : 'degraded'
    return runtime
  }
  async snapshot() {
    const raw = await this.ctx.store.call('settings.raw')
    const credentialRefs: Record<string, string> = {}
    const connections = (raw.connections ?? []).map((connection: any) => {
      if (connection.credential_ref) credentialRefs[connection.adapter] = connection.credential_ref
      return { adapter: connection.adapter, base_url: connection.base_url }
    })
    return { connections, credentialRefs }
  }
  async credentials(task: TaskRecord) {
    const result: Record<string, { base_url: string; api_key?: string | null }> = {}
    for (const connection of task.connections) {
      const ref = task.credentialRefs[connection.adapter]
      const api_key = ref ? await this.ctx.secrets.get(ref) : null
      if (ref && !api_key) throw new AppError('MODEL_NOT_READY', `Credential for ${connection.adapter} is unavailable.`, 503)
      result[connection.adapter] = { base_url: connection.base_url, api_key }
    }
    return result
  }
}
