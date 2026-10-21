/** Saved-key summary for a provider card; credential editing stays in the official editor. */
import React, { useEffect, useState } from 'react'

interface Preview { preview: string | null }
interface Props {
  provider: { provider: string }
  configured: boolean
  keyConfigured: boolean
  read(provider: string, signal: AbortSignal): Promise<Preview>
  subscribe(listener: () => void): () => void
  t(key: string): string
}

export function SavedCredentialPreview({ provider, configured, keyConfigured, read, subscribe, t }: Props) {
  const [state, setState] = useState<{ preview: string | null; error: string }>({ preview: null, error: '' })
  useEffect(() => {
    if (!configured || !keyConfigured) { setState({ preview: null, error: '' }); return }
    let pending: AbortController | undefined
    const refresh = () => {
      pending?.abort()
      const controller = pending = new AbortController()
      void read(provider.provider, controller.signal).then(value => {
        if (!controller.signal.aborted) setState({ preview: value.preview, error: '' })
      }, error => {
        if (!controller.signal.aborted) setState({ preview: null, error: error instanceof Error ? error.message : String(error) })
      })
    }
    const dispose = subscribe(refresh)
    refresh()
    return () => { pending?.abort(); dispose() }
  }, [provider.provider, configured, keyConfigured, read, subscribe])
  if (!configured || !keyConfigured) return null
  if (state.error) return <p role="alert" className="yd-credential-preview yd-credential-error">{t('error')}{state.error}</p>
  return state.preview ? <p className="yd-credential-preview"><span>{t('saved')}</span><code>{state.preview}</code></p> : null
}
