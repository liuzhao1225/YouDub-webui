/** Narrow HTTP facade for the original Harness model-settings wire contracts. */
export interface ConfigurableProviderView {
  provider: string; displayName: string; settingsNs: string; settingsPath: string[]
  active: boolean; declared?: boolean; unavailableReason?: string
}
export interface SettingsNamespaceView {
  ns: string; schema: unknown; value: unknown; base?: unknown; user?: unknown
  applies: 'live' | 'restart'; secrets: { path: string[]; set: boolean }[]; revision: number
}
export type SettingsPathOpView = { op: 'set'; path: string[]; value: unknown } | { op: 'unset'; path: string[] }
export interface CredentialView { configured: boolean; source?: string; writable: boolean; hint?: string }
export interface DiscoveredModelView { id: string; name?: string; contextWindow?: number; maxTokens?: number }
export type Result<T> = { result: { ok: true; value: T } | { ok: false; error: { code: string; message: string } } }
export interface IApiClient {
  llm: {
    providers(input: Record<string, never>): Promise<Result<{ providers: ConfigurableProviderView[] }>>
    discoverModels(input: { settingsNs: string; provider?: string; baseURL?: string; api?: string; apiKey?: string }): Promise<Result<{ models: DiscoveredModelView[] }>>
  }
  settings: {
    describe(input: Record<string, never>): Promise<Result<{ writable: boolean; hasDocument: boolean; namespaces: SettingsNamespaceView[] }>>
    mutate(input: { ns: string; ops: SettingsPathOpView[]; expectedRevision?: number }): Promise<Result<SettingsNamespaceView>>
  }
  credentials: {
    describe(input: { refs: string[] }): Promise<Result<{ credentials: Record<string, CredentialView> }>>
    set(input: { ref: string; value: string }): Promise<Result<unknown>>
    unset(input: { ref: string }): Promise<Result<unknown>>
  }
}
