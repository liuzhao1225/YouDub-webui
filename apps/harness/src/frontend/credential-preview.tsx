/** Add saved-key summaries through the official provider-card slots. */
import { SavedCredentialPreview } from '../../../web/src/components/saved-credential-preview'
import { responseBody } from '../../../web/src/runtime/http'

interface Preview { preview: string | null }

export function applyCredentialPreview(ctx: any) {
  const namespace = 'youdub.credential-preview'
  ctx.effect(() => ctx.locale.register(namespace, {
    zh: { saved: '已保存的 API Key', error: '读取密钥摘要失败：' },
    en: { saved: 'Saved API Key', error: 'Could not read the key preview: ' },
  }))
  const read = async (provider: string, signal: AbortSignal): Promise<Preview> => responseBody(await fetch(`/api/youdub/credential-preview?provider=${encodeURIComponent(provider)}`, { signal, credentials: 'include', cache: 'no-store' }))
  const subscribe = (listener: () => void) => {
    const off = ['credentials/reference-updated', 'credentials/record-updated', 'settings/document-updated'].map(event => ctx.remote.$on(event, listener))
    off.push(ctx.on('connection/reset', listener))
    return () => off.forEach(dispose => dispose())
  }
  // These are the official API-key adapter families composed by this product.
  for (const name of ['settings.models.provider-card', 'youdub.setup.models.provider-card']) {
    ctx.slots.inject(name, function* () {
      for (const key of ['llm-pi-ai', 'llm-deepseek']) yield ctx.slots.register({ name, key, locale: namespace, inject: () => ({ read, subscribe }) }, SavedCredentialPreview)
    })
  }
}
