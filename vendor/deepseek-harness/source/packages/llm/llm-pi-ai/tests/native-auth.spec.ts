import { describe, expect, it, vi } from 'vitest'
import type { Provider } from '@earendil-works/pi-ai'
import { builtinProviders } from '@earendil-works/pi-ai/providers/all'
import { generateProviderData, resolverEnv } from '../scripts/gen-provider-data.ts'
import { catalogProvider } from '../src/catalog.ts'
import { PROVIDER_DATA } from '../src/provider-data.generated.ts'
import { providerDefaultsOf } from '../src/provider-data.ts'

describe('provider metadata', () => {
  it('matches every installed public resolver and catalog, including non-chat providers', async () => {
    expect(await generateProviderData()).toEqual(PROVIDER_DATA)
    expect(Object.keys(PROVIDER_DATA)).toEqual(builtinProviders().map(provider => provider.id))
  })

  it('finds short-circuit credential pairs and federation fields missed by findEnvKeys', async () => {
    const data = await generateProviderData()
    expect(data['amazon-bedrock']!.env).toContain('AWS_SECRET_ACCESS_KEY')
    expect(data['anthropic']!.env).toEqual([
      'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_OAUTH_TOKEN', 'ANTHROPIC_API_KEY',
      'ANTHROPIC_FEDERATION_RULE_ID', 'ANTHROPIC_ORGANIZATION_ID',
      'ANTHROPIC_IDENTITY_TOKEN_FILE', 'ANTHROPIC_SERVICE_ACCOUNT_ID', 'ANTHROPIC_WORKSPACE_ID',
    ])
    expect(data['google-vertex']!.env).toContain('GOOGLE_APPLICATION_CREDENTIALS')
    expect(data['cloudflare-ai-gateway']!.env).toEqual(['CLOUDFLARE_API_KEY', 'CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_GATEWAY_ID'])
    expect(data['cloudflare-workers-ai']!.env).toEqual(['CLOUDFLARE_API_KEY', 'CLOUDFLARE_ACCOUNT_ID'])
  })

  it('uses fixed catalog endpoints and keeps dynamic or model-specific endpoints distinct', () => {
    expect(PROVIDER_DATA.openai.defaultBaseURL).toBe('https://api.openai.com/v1')
    expect(PROVIDER_DATA.radius.defaultBaseURL).toBe('https://radius.pi.dev/v1')
    expect(PROVIDER_DATA.azure.defaultBaseURL).toBeUndefined()
    expect(PROVIDER_DATA.azure.baseURLEnv).toEqual(['AZURE_OPENAI_BASE_URL', 'AZURE_OPENAI_RESOURCE_NAME'])
    expect(PROVIDER_DATA['cloudflare-ai-gateway'].defaultBaseURL).toBeUndefined()
    expect(PROVIDER_DATA['cloudflare-ai-gateway'].baseURLEnv).toEqual(['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_GATEWAY_ID'])
    expect(PROVIDER_DATA['amazon-bedrock'].defaultBaseURL).toBeUndefined()
    expect(PROVIDER_DATA.opencode.defaultBaseURL).toBeUndefined()
  })

  it('does not execute authentication when returning metadata at runtime', () => {
    const provider = catalogProvider('openai')!
    const resolve = vi.fn(() => { throw new Error('must not execute') })
    expect(providerDefaultsOf({ ...provider, auth: { apiKey: { name: 'fixture', resolve } } })).toEqual({
      defaultBaseURL: 'https://api.openai.com/v1', nativeAuth: { env: ['OPENAI_API_KEY'], oauth: false },
    })
    expect(resolve).not.toHaveBeenCalled()
  })

  it('keeps an empty resolver result without consulting compatibility fallbacks', async () => {
    const provider = catalogProvider('openai-codex')!
    expect((await generateProviderData([provider]))[provider.id]!.env).toEqual([])
  })

  it('keeps a newly installed provider configurable without guessed metadata', () => {
    const provider = { ...catalogProvider('openai')!, id: 'new-provider' }
    expect(providerDefaultsOf(provider)).toEqual({ defaultBaseURL: 'https://api.openai.com/v1' })
    expect(providerDefaultsOf({ ...catalogProvider('azure')!, id: 'new-provider' })).toEqual({})
    expect(providerDefaultsOf({ ...provider, baseUrl: 'https://{ACCOUNT}.example' })).toEqual({})
  })

  it('reports a resolver failure before using compatibility metadata, and refuses unknown metadata', async () => {
    const provider: Provider = { ...catalogProvider('deepseek')!, auth: { apiKey: {
      name: 'fixture', resolve: () => Promise.reject(new Error('unsupported probe')),
    } } }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      expect((await generateProviderData([provider])).deepseek!.env).toEqual(['DEEPSEEK_API_KEY'])
      expect(warn).toHaveBeenCalledWith('deepseek: using findEnvKeys auth metadata fallback', expect.any(Error))
      await expect(generateProviderData([{ ...provider, id: 'unknown-provider' }])).rejects.toThrow('no auth metadata fallback')
    } finally { warn.mockRestore() }
  })

  it('cancels a probe even when a resolver does not observe the signal', async () => {
    vi.useFakeTimers()
    try {
      const provider: Provider = { ...catalogProvider('deepseek')!, auth: { apiKey: {
        name: 'fixture', resolve: () => new Promise(() => {}),
      } } }
      const assertion = expect(resolverEnv(provider)).rejects.toThrow('probe timed out')
      await vi.advanceTimersByTimeAsync(2000)
      await assertion
    } finally { vi.useRealTimers() }
  })
})
