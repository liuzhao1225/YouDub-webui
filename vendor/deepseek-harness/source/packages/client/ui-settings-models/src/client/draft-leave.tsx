/** The model section owns confirmation; cards expose their current draft state. */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SettingsSectionOwnerProps } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { en } from './locales.ts'

type DraftState = { dirty: boolean; busy: boolean }
type DraftReader = () => DraftState
export type RegisterDraft = (read: DraftReader) => () => void

/** Register an imperative leave check; draft values remain in their original card. */
export function useDraftLeaveCheck(register: RegisterDraft | undefined, dirty: boolean, busy: boolean): void {
  useEffect(() => register?.(() => ({ dirty, busy })), [register, dirty, busy])
}

/** Guard settings navigation and browser/native unload with one confirmation surface. */
export function useModelLeaveGuard(
  register: SettingsSectionOwnerProps['registerLeaveGuard'],
  busy: boolean,
  t: (key: keyof typeof en) => string,
) {
  const drafts = useRef(new Set<DraftReader>())
  const [confirmation, setConfirmation] = useState(false)
  const pending = useRef<((value: boolean) => void) | undefined>(undefined)
  const registerDraft = useCallback<RegisterDraft>(read => {
    drafts.current.add(read)
    return () => { drafts.current.delete(read) }
  }, [])
  const requestLeave = useCallback((): boolean | Promise<boolean> => {
    const states = [...drafts.current].map(read => read())
    if (busy || states.some(state => state.busy)) return false
    if (!states.some(state => state.dirty)) return true
    if (pending.current) return false
    const promise = new Promise<boolean>(resolve => { pending.current = resolve })
    setConfirmation(true)
    return promise
  }, [busy])
  useEffect(() => register?.(requestLeave), [register, requestLeave])
  useEffect(() => {
    const onUnload = (event: BeforeUnloadEvent): void => {
      if (!busy && ![...drafts.current].some(read => { const state = read(); return state.dirty || state.busy })) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onUnload)
    return () => { window.removeEventListener('beforeunload', onUnload) }
  }, [busy])
  useEffect(() => () => { pending.current?.(false) }, [])

  const finish = (discard: boolean): void => {
    pending.current?.(discard)
    pending.current = undefined
    setConfirmation(false)
  }
  const leave = (action: () => void): void => {
    const allowed = requestLeave()
    if (typeof allowed === 'boolean') { if (allowed) action() }
    else void allowed.then(value => { if (value) action() })
  }
  return {
    registerDraft, leave,
    dialog: <Modal open={confirmation} title={t('discardTitle')} description={t('discardDescription')}
      closeLabel={t('close')} onClose={() => { finish(false) }}
      footer={<><Button variant="outline" data-modal-autofocus onClick={() => { finish(false) }}>{t('keepEditing')}</Button>
        <Button onClick={() => { finish(true) }}>{t('discardChanges')}</Button></>} />,
  }
}
