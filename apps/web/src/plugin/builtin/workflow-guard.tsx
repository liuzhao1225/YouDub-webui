import { useEffect, useRef, useState } from 'react'
import { Dialog } from '@base-ui/react/dialog'
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
  const keepEditing = useRef<HTMLButtonElement>(null)
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
    dialog: pending ? <Dialog.Root open onOpenChange={open => { if (!open && !busy) finish(false) }}>
      <Dialog.Portal>
      <Dialog.Backdrop className="fixed inset-0 z-[80] bg-black/50" />
      <Dialog.Popup initialFocus={keepEditing} aria-describedby={undefined} className="fixed top-1/2 left-1/2 z-[80] w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 space-y-4 rounded-xl border border-border bg-card p-6 shadow-float outline-none">
        <Dialog.Title className="text-lg font-semibold">{tx("workflow.guard.unsaved.changes")}</Dialog.Title>
        {error && <InlineAlert>{error}</InlineAlert>}
        <div className="flex flex-wrap gap-2">
          {save && <Button disabled={busy} onClick={() => { const action = latest.current.save; if (!action) return; setBusy(true); setError(''); void action().then(() => finish(true)).catch((failure: Error) => setError(failure.message)).finally(() => setBusy(false)) }}>{tx("workflow.guard.save.and.leave")}</Button>}
          <Button variant="outline" disabled={busy} onClick={() => { latest.current.onDiscard?.(); finish(true) }}>{tx("workflow.guard.discard.changes")}</Button>
          <Button data-modal-autofocus ref={keepEditing} variant="ghost" disabled={busy} onClick={() => finish(false)}>{tx("workflow.guard.keep.editing")}</Button>
        </div>
      </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root> : null,
  }
}
