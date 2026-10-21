import { Service, type Context } from 'cordis'
import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createModels } from '@earendil-works/pi-ai'
import { AppError, type JsonObject, type Disposer, type OperationProvider } from '@youdub/sdk'
import { Config, resolveProfiles, type PiAiProviderProfile } from './harness-llm/config.js'
import { catalogProviderIds, catalogProviderTakesApiKey } from './harness-llm/catalog.js'
import { discoverModels } from './harness-llm/discovery.js'
import { normalizeApiKey } from './harness-llm/support.js'
import { operations } from './media-contracts.js'
import { validateMediaCorrection } from './node-contracts.js'
import { translateWithModel, MIN_OUTPUT_TOKENS } from './llm-translation.js'

const KEY = 'llm-providers-v1', NS = 'llm-pi-ai'
interface State { version: 1; revision: number; providers: Record<string, PiAiProviderProfile>; retired: Record<string, PiAiProviderProfile>; credentials: Record<string, string> }
const empty = (): State => ({ version: 1, revision: 0, providers: {}, retired: {}, credentials: {} })
const object = (value: unknown): value is JsonObject => !!value && typeof value === 'object' && !Array.isArray(value)
const reference = (value: string) => { if (typeof value !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) throw new AppError('INVALID_CREDENTIAL', 'Invalid credential reference.', 422); return value }
const route = (value: string) => { if (!/^[a-z0-9][a-z0-9._-]*$/.test(value) || ['__proto__', 'constructor', 'prototype'].includes(value)) throw new AppError('settings-rejected', 'Invalid provider route.', 422); return value }

export default class Models extends Service {
  static inject = ['store', 'secrets', 'settings', 'catalog']
  private state = empty()
  private registrations = new Map<string, Disposer>()
  private integrity = ''
  constructor(ctx: Context) { super(ctx, 'models') }
  async [Service.init]() {
    const hash = createHash('sha256').update('pi-ai@0.82.1')
    for (const file of ['llm-translation.ts', 'harness-llm/catalog.ts', 'harness-llm/provider.ts', 'harness-llm/config.ts']) hash.update(await readFile(new URL(file, import.meta.url)))
    this.integrity = 'sha256:' + hash.digest('hex')
    const raw = await this.ctx.store.call('settings.raw')
    if (raw[KEY] !== undefined) this.state = raw[KEY]
    else {
      const previous = raw.connections?.find((item: any) => item.adapter === 'openai')
      if (previous && (previous.credential_ref || previous.base_url?.trim() || previous.model?.trim())) {
        const names = [...new Set([previous.model, raw.defaults?.translation?.model, ...(process.env.YOUDUB_TRANSLATION_MODELS ?? 'gpt-4.1-mini').split(',')].filter((name): name is string => typeof name === 'string' && !!name.trim()).map(name => name.trim()))]
        this.state.providers['openai-compatible'] = { displayName: 'OpenAI compatible', api: 'openai-completions', baseURL: previous.base_url, models: names.map(id => ({ id })), ...(previous.credential_ref ? { apiKeyEnv: 'YOUDUB_LEGACY_OPENAI_API_KEY' } : {}) }
        if (previous.credential_ref) this.state.credentials.YOUDUB_LEGACY_OPENAI_API_KEY = previous.credential_ref
      }
      await this.ctx.store.call('settings.write', { key: KEY, value: this.state })
    }
    if (this.state.version !== 1 || !object(this.state.providers) || !object(this.state.credentials) || !object(this.state.retired)) throw new AppError('INVALID_MODEL_SETTINGS', 'Stored model settings are invalid.', 500)
    this.validate(this.state.providers)
    await this.refresh()
    this.ctx.effect(() => () => { for (const dispose of this.registrations.values()) dispose() })
  }
  private validate(providers: Record<string, PiAiProviderProfile>) {
    try {
      for (const [id, profile] of Object.entries(providers)) { route(id); if (profile.apiKeyEnv !== undefined) reference(profile.apiKeyEnv) }
      Config({ providers: structuredClone(providers) })
      return resolveProfiles(providers)
    } catch (error) { throw new AppError('settings-rejected', (error as Error).message, 422) }
  }
  private async key(ref: string): Promise<string | undefined> {
    reference(ref)
    if (process.env[ref]) return process.env[ref]
    const stored = this.state.credentials[ref]
    return stored ? await this.ctx.secrets.get(stored) ?? undefined : undefined
  }
  private async save(next: State) {
    await this.ctx.store.call('settings.write', { key: KEY, value: next })
    this.state = next
    await this.refresh()
    this.ctx.emit('settings/updated', await this.ctx.settings.read())
  }
  private namespace() {
    const value = { providers: structuredClone(this.state.providers) }
    return { ns: NS, schema: Config.toJSON(), value, user: value, base: { providers: {} }, applies: 'live', secrets: [], revision: this.state.revision }
  }
  describe() { return { writable: true, hasDocument: false, namespaces: [this.namespace()] } }
  providers() {
    const catalog = new Set(catalogProviderIds()), configured = this.state.providers
    const ids = new Set([...catalog].filter(catalogProviderTakesApiKey))
    Object.keys(configured).forEach(id => ids.add(id))
    return { providers: [...ids].map(provider => {
      const descriptor = Object.hasOwn(configured, provider) ? this.ctx.catalog.provider('llm.' + provider).describe() : undefined
      return { provider, displayName: configured[provider]?.displayName ?? provider, settingsNs: NS, settingsPath: ['providers', provider], active: descriptor?.available === true, declared: !catalog.has(provider), ...(descriptor && !descriptor.available && descriptor.unavailableReason ? { unavailableReason: descriptor.unavailableReason } : {}) }
    }) }
  }
  async mutate(request: JsonObject) {
    return this.ctx.settings.locked(async () => {
      if (request.ns !== NS || !Array.isArray(request.ops) || !request.ops.length) throw new AppError('settings-rejected', 'A models settings mutation is required.', 422)
      if (request.expectedRevision !== undefined && request.expectedRevision !== this.state.revision) throw new AppError('settings-conflict', 'Model settings changed. Reload before saving.', 409)
      const next = structuredClone(this.state), document: JsonObject = { providers: next.providers }
      for (const op of request.ops) {
        if (!['set', 'unset'].includes(op.op) || !Array.isArray(op.path) || op.path.length < 2 || op.path[0] !== 'providers' || op.path.some((key: unknown) => typeof key !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(key))) throw new AppError('settings-rejected', 'Invalid model settings path.', 422)
        let target = document
        for (const key of op.path.slice(0, -1)) { if (!object(target[key])) target[key] = {}; target = target[key] }
        if (op.op === 'set') target[op.path.at(-1)] = structuredClone(op.value)
        else delete target[op.path.at(-1)]
      }
      this.validate(next.providers)
      for (const [id, profile] of Object.entries(this.state.providers)) if (!Object.hasOwn(next.providers, id)) next.retired[id] = profile
      for (const id of Object.keys(next.providers)) delete next.retired[id]
      next.revision++
      await this.save(next)
      return this.namespace()
    })
  }
  async credentialsDescribe({ refs }: { refs: string[] }) {
    if (!Array.isArray(refs)) throw new AppError('INVALID_CREDENTIAL', 'Credential references must be an array.', 422)
    const credentials: JsonObject = {}
    for (const ref of refs) {
      const key = await this.key(ref), env = Boolean(process.env[ref])
      credentials[ref] = { configured: !!key, writable: !env, ...(key ? { source: env ? 'env' : 'file', hint: key.length > 10 ? key.slice(0, 6) + '****' : '****' } : {}) }
    }
    return { credentials }
  }
  async credentialsSet(ref: string, value: string) {
    reference(ref)
    if (typeof value !== 'string') throw new AppError('INVALID_CREDENTIAL', 'API key must be a string.', 422)
    const checked = normalizeApiKey(value)
    if (!checked.ok) throw new AppError('INVALID_CREDENTIAL', 'Enter a nonempty API key containing only HTTP header characters.', 422)
    return this.ctx.settings.locked(async () => {
      if (process.env[ref]) throw new AppError('CREDENTIAL_READ_ONLY', `${ref} is supplied by the launch environment.`, 409)
      const next = structuredClone(this.state), id = randomUUID()
      await this.ctx.secrets.set(id, checked.value)
      next.credentials[ref] = id
      // Previous secret references remain available to already-created tasks.
      await this.save(next)
      return {}
    })
  }
  async credentialsUnset(ref: string) {
    reference(ref)
    return this.ctx.settings.locked(async () => {
      if (process.env[ref]) throw new AppError('CREDENTIAL_READ_ONLY', `${ref} is supplied by the launch environment.`, 409)
      const next = structuredClone(this.state)
      delete next.credentials[ref]
      await this.save(next)
      return {}
    })
  }
  async discover(request: JsonObject) {
    if (request.settingsNs !== NS) throw new AppError('DISCOVERY_UNSUPPORTED', 'Unknown model adapter.', 422)
    try {
      const models = await discoverModels({ ...request, signal: request.signal ?? AbortSignal.timeout(30_000) }, async () => {
        const saved = request.provider && this.state.providers[request.provider]
        if (!saved?.apiKeyEnv) return undefined
        const current = resolveProfiles({ [request.provider]: saved }).get(request.provider)!
        const model = current.piProvider.getModels()[0]
        if (request.baseURL?.replace(/\/+$/, '') !== model?.baseUrl.replace(/\/+$/, '') || (request.api ?? 'openai-completions') !== model?.api) throw new AppError('DISCOVERY_CREDENTIAL_REQUIRED', 'The endpoint or protocol changed. Enter its API key before fetching models.', 422)
        return this.key(saved.apiKeyEnv)
      })
      return { models }
    } catch (error) { throw new AppError((error as any).code ?? 'DISCOVERY_FAILED', (error as Error).message, 422) }
  }
  snapshot() {
    const connections: JsonObject[] = [], credentialRefs: Record<string, string> = {}
    for (const [id, profile] of Object.entries(this.state.providers)) {
      const adapter = 'llm.' + id
      connections.push({ adapter, base_url: profile.baseURL ?? '', profile: structuredClone(profile) })
      if (profile.apiKeyEnv) {
        const ref = profile.apiKeyEnv
        const stored = process.env[ref] ? 'env:' + ref : this.state.credentials[ref]
        if (stored) credentialRefs[adapter] = stored
        else credentialRefs[adapter] = 'env:' + ref
      }
    }
    return { connections, credentialRefs }
  }
  private async refresh() {
    const profiles = resolveProfiles({ ...this.state.retired, ...this.state.providers })
    for (const [id, profile] of profiles) {
      if (this.registrations.has(id)) continue
      const provider: OperationProvider = {
        id: 'llm.' + id,
        describe: () => structuredClone(description),
        probe: async () => {
          const source = this.state.providers[id], retired = !source
          const current = resolveProfiles({ [id]: source ?? this.state.retired[id] }).get(id)!
          const models = current.piProvider.getModels()
          const incompatibility = (model: (typeof models)[number]) => model.api === 'openai-codex-responses' ? `This protocol cannot send an explicit ${MIN_OUTPUT_TOKENS} output limit.` : model.maxTokens < MIN_OUTPUT_TOKENS ? `Model output capacity ${model.maxTokens} is below ${MIN_OUTPUT_TOKENS}.` : null
          Object.assign(description, { label: current.displayName, legacy: retired, models: models.map(model => ({ id: model.id, label: model.name, name: model.name, devices: ['remote'], source_languages: ['en', 'zh', 'ja'], target_languages: ['en', 'zh', 'ja'], max_text_chars: 6000, maxTokens: model.maxTokens, contextWindow: model.contextWindow, available: !incompatibility(model), unavailableReason: incompatibility(model) })) })
          let reason: string | null = retired ? 'Provider was removed from model settings.' : null
          if (!reason) {
            const key = current.apiKeyEnv ? await this.key(current.apiKeyEnv) : undefined
            if (current.apiKeyEnv && !key) reason = `Credential ${current.apiKeyEnv} is not configured.`
            else {
              const collection = createModels(); collection.setProvider(current.piProvider)
              const auth = await collection.getAuth(id, key ? { apiKey: key } : undefined)
              if (!auth) reason = 'Provider authentication is not configured.'
              else if (models.every(model => ['openai-completions', 'openai-responses', 'anthropic-messages'].includes(model.api)) && !auth.auth.apiKey && !Object.entries({ ...auth.auth.headers, ...current.headers }).some(([name, value]) => ['authorization', 'x-api-key', 'cf-aig-authorization'].includes(name.toLowerCase()) && typeof value === 'string' && !!value.trim())) reason = 'This protocol requires an API key or authentication header.'
            }
          }
          if (!reason && !models.some(model => !incompatibility(model))) reason = `This provider has no configured model supporting ${MIN_OUTPUT_TOKENS} output tokens.`
          description.available = !reason; description.unavailableReason = reason
          return { available: !reason, reason }
        },
        validateCorrection: validateMediaCorrection,
        execute: (request, context) => translateWithModel(id, request, context),
      }
      const description = { id: provider.id, label: profile.displayName, pluginId: 'youdub.llm', pluginVersion: '1.0.0', integrity: this.integrity, capability: 'translation', adapter: provider.id, execution: 'remote' as const, resources: { dependencyGroups: [] }, operations: [structuredClone(operations.translate)], available: false, unavailableReason: null as string | null, models: [] as JsonObject[], legacy: false }
      await provider.probe()
      this.registrations.set(id, this.ctx.catalog.registerProvider(provider))
    }
    for (const id of this.registrations.keys()) await this.ctx.catalog.provider('llm.' + id).probe()
  }
}

declare module 'cordis' { interface Context { models: Models } }
