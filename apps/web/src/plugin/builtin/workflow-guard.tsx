import { useEffect, useRef, useState } from 'react'
import type { ClientBindings } from '../sdk'
import { useText } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { InlineAlert } from '@/components/inline-alert'

export function useUnsavedChanges(blockNavigation: ClientBindings['blockNavigation'], dirty: boolean, save?: () => Promise<void>, allow?: (path: string) => boolean, onDiscard?: () => void) {
  const tx = useText()
  const latest = useRef({ dirty, save, allow, onDiscard })
  useEffect(() => { latest.current = { dirty, save, allow, onDiscard } }, [dirty, save, allow, onDiscard])
  const bypass = useRef(false)
  const [pending, setPending] = useState<{ resolve(value: boolean): void } | null>(null)
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  useEffect(() => {
    const remove = blockNavigation(async (path) => {
      if (bypass.current || !latest.current.dirty || latest.current.allow?.(path)) return true
      return new Promise<boolean>((resolve) => setPending({ resolve }))
    })
    const unload = (event: BeforeUnloadEvent) => { if (latest.current.dirty && !bypass.current) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', unload)
    return () => { remove?.(); window.removeEventListener('beforeunload', unload) }
  }, [blockNavigation])
  function finish(value: boolean) { pending?.resolve(value); setPending(null); setError('') }
  return {
    bypass: () => { bypass.current = true },
    dialog: pending ? <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="unsaved-title">
      <div className="w-full max-w-md space-y-5 rounded-2xl border border-border bg-card p-6 shadow-float">
        <h2 id="unsaved-title" className="text-lg font-semibold">{tx('Unsaved changes', '有未保存的修改', '未保存の変更があります')}</h2>
        {error && <InlineAlert>{error}</InlineAlert>}
        <div className="flex flex-wrap gap-2">
          {save && <Button disabled={busy} onClick={() => { const action = latest.current.save; if (!action) return; setBusy(true); setError(''); void action().then(() => finish(true)).catch((failure: Error) => setError(failure.message)).finally(() => setBusy(false)) }}>{tx('Save and leave', '保存并离开', '保存して移動')}</Button>}
          <Button variant="outline" disabled={busy} onClick={() => { latest.current.onDiscard?.(); finish(true) }}>{tx('Discard changes', '放弃修改', '変更を破棄')}</Button>
          <Button variant="ghost" disabled={busy} onClick={() => finish(false)}>{tx('Keep editing', '继续编辑', '編集を続ける')}</Button>
        </div>
      </div>
    </div> : null,
  }
}
