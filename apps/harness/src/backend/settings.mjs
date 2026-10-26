import { Service } from '@deepseek-ai/cordis';
import { credentialRef } from '@deepseek-ai/dsh-credentials';
import { randomUUID } from 'node:crypto';
const fail = (code, message, status = 422) => Object.assign(new Error(message), { code, status });
const object = value => value && typeof value === 'object' && !Array.isArray(value);

// Task snapshots are business records; editable preferences and credentials are
// stored by the official Harness profile and credential services.
export default class YouDubSettings extends Service {
  static inject = ['store', 'catalog', 'credentials'];
  constructor(ctx, config) { super(ctx, 'settings'); this.config = config; this.lock = Promise.resolve(); }
  async locked(action) {
    const previous = this.lock; let release;
    this.lock = new Promise(resolve => { release = resolve; }); await previous;
    try { return await action(); } finally { release(); }
  }
  preferences() { return this.config.preferences.get(); }
  async read() {
    const state = this.preferences();
    const connections = await Promise.all((state.connections ?? []).map(async item => ({ adapter: item.adapter, base_url: item.base_url,
      has_api_key: item.credential_ref ? (await this.ctx.credentials.describe(credentialRef(item.credential_ref))).configured : false,
      ...(item.model ? { model: item.model } : {}) })));
    return { defaults: state.defaults ?? null, ui_language: state.ui_language ?? 'zh', plugins: state.plugins ?? {}, connections };
  }
  async write(next) {
    const descriptor = this.config.forms.describe().find(item => item.ns === 'youdub-subtitles');
    if (!descriptor) throw fail('HARNESS_CONFIG_UNAVAILABLE', 'YouDub profile entry is unavailable in model settings.', 503);
    await this.config.forms.update('youdub-subtitles', { preferences: next }, descriptor.revision);
  }
  patch(patch) { return this.locked(async () => {
    if (!object(patch) || Object.keys(patch).length !== 1) throw fail('INVALID_CONFIG', 'Settings requires one operation.');
    const current = structuredClone(this.preferences());
    if (Object.hasOwn(patch, 'plugin')) {
      const plugin = patch.plugin;
      if (!object(plugin) || !/^[a-z][a-z0-9.-]{1,100}$/.test(plugin.id) || !object(plugin.config) || Object.keys(plugin).some(key => !['id', 'config'].includes(key))) throw fail('INVALID_CONFIG', 'Invalid plugin preferences.');
      current.plugins = { ...current.plugins, [plugin.id]: { ...current.plugins?.[plugin.id], ...plugin.config } };
    } else if (Object.hasOwn(patch, 'ui_language')) {
      if (!['zh', 'en', 'ja'].includes(patch.ui_language)) throw fail('INVALID_CONFIG', 'Unsupported language.');
      current.ui_language = patch.ui_language;
    } else if (Object.hasOwn(patch, 'defaults')) {
      current.defaults = await this.ctx.store.call('settings.validate_defaults', { defaults: patch.defaults });
    } else if (Object.hasOwn(patch, 'connection')) {
      const input = patch.connection;
      if (!object(input) || typeof input.adapter !== 'string' || Object.keys(input).some(key => !['adapter', 'base_url', 'model', 'api_key'].includes(key))) throw fail('INVALID_CONFIG', 'Invalid connection.');
      if (input.adapter === 'openai' || input.adapter.startsWith('llm.')) throw fail('HARNESS_MODELS_REQUIRED', '请在模型设置中配置翻译供应商。', 409);
      const previous = current.connections?.find(item => item.adapter === input.adapter);
      const next = { ...previous, adapter: input.adapter, ...(input.base_url ? { base_url: input.base_url } : {}), ...(input.model ? { model: input.model } : {}) };
      const url = new URL(next.base_url); if (!['https:', 'http:'].includes(url.protocol)) throw fail('INVALID_CONFIG', 'Connection requires an HTTP(S) URL.');
      if (Object.hasOwn(input, 'api_key')) {
        if (input.api_key === null) delete next.credential_ref;
        else {
          if (typeof input.api_key !== 'string' || !input.api_key.trim()) throw fail('INVALID_CONFIG', 'API key is empty.');
          next.credential_ref = 'YOUDUB_' + randomUUID().replaceAll('-', '_').toUpperCase();
          await this.ctx.credentials.set(credentialRef(next.credential_ref), input.api_key);
        }
      }
      current.connections = [...(current.connections ?? []).filter(item => item.adapter !== input.adapter), next];
    } else throw fail('INVALID_CONFIG', 'Unknown settings operation.');
    await this.write(current);
    this.ctx.emit('settings/updated', await this.read());
    await this.ctx.catalog.refresh();
    return this.read();
  }); }
  async snapshot() {
    const current = this.preferences();
    return { connections: (current.connections ?? []).map(({ adapter, base_url }) => ({ adapter, base_url })),
      credentialRefs: Object.fromEntries((current.connections ?? []).filter(item => item.credential_ref).map(item => [item.adapter, item.credential_ref])) };
  }
  async credentials(task) {
    const credentials = {};
    for (const connection of task.connections) {
      const ref = task.credentialRefs[connection.adapter];
      const found = ref ? await this.ctx.credentials.resolve(credentialRef(ref.startsWith('env:') ? ref.slice(4) : ref)) : undefined;
      if (ref && !found) throw fail('MODEL_NOT_READY', `Credential for ${connection.adapter} is unavailable.`, 503);
      credentials[connection.adapter] = { base_url: connection.base_url, api_key: found?.value ?? null };
    }
    return credentials;
  }
  async runtime() {
    await this.ctx.catalog.refresh();
    const runtime = await this.ctx.store.call('runtime.info');
    runtime.capabilities = this.ctx.catalog.describe().providers.filter(item => item.capability && !item.legacy).map(provider => ({ adapter: provider.adapter ?? provider.id,
      capability: provider.capability, execution: provider.execution, available: provider.available ?? false, unavailable_reason: provider.unavailableReason ?? null,
      requires_api_key: provider.requiresApiKey ?? provider.execution === 'remote', models: provider.models ?? [], data_sent: provider.dataSent ?? [], remote_operations: provider.remoteOperations ?? null }));
    runtime.status = runtime.capabilities.filter(item => item.capability !== 'subtitle_alignment').every(item => item.available) ? 'ready' : 'degraded';
    return runtime;
  }
  async testConnection() { throw fail('HARNESS_MODELS_REQUIRED', '请在模型设置中检查供应商连接。', 409); }
}
