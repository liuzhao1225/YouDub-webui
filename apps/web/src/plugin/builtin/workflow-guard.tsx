import { useEffect, useRef, useState } from 'react'
import { Modal } from '../../components/ui/harness-primitives'
import type { ClientBindings } from '../sdk'
import { useText } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { InlineAlert } from '@/components/inline-alert'
import layout from '../../components/ui/surfaces.module.css'

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
    dialog: pending ? <Modal open onClose={() => { if (!busy) finish(false) }} title={tx("workflow.guard.unsaved.changes")} headless className={layout.dialogContent}>
      <div className="flex min-h-0 flex-col gap-5">
        <h2 className="m-0 text-base leading-6 font-medium">{tx("workflow.guard.unsaved.changes")}</h2>
        {error && <InlineAlert>{error}</InlineAlert>}
        <div className="flex flex-wrap gap-2">
          {save && <Button disabled={busy} onClick={() => { const action = latest.current.save; if (!action) return; setBusy(true); setError(''); void action().then(() => finish(true)).catch((failure: Error) => setError(failure.message)).finally(() => setBusy(false)) }}>{tx("workflow.guard.save.and.leave")}</Button>}
          <Button variant="outline" disabled={busy} onClick={() => { latest.current.onDiscard?.(); finish(true) }}>{tx("workflow.guard.discard.changes")}</Button>
          <Button data-modal-autofocus variant="ghost" disabled={busy} onClick={() => finish(false)}>{tx("workflow.guard.keep.editing")}</Button>
        </div>
      </div>
    </Modal> : null,
  }
}
