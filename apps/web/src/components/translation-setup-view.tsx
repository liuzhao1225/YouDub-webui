import type { ReactNode } from 'react'
import { Button } from './ui/button'
import { TranslationSetupController } from '@/runtime/onboarding'
import { useObservableSource, usePendingUnload } from '@/plugin/view-hooks'
import { useText } from '@/lib/i18n'
import { SetupPage } from './setup-page'
import { InlineAlert } from './inline-alert'

/** Original first-run page shared by the web product and Harness composition. */
export function TranslationSetupView({ controller, children, saving, wordmarkSrc, onLeave }: {
  controller: TranslationSetupController
  children: ReactNode
  saving: boolean
  wordmarkSrc?: string
  onLeave(action: () => void): void
}) {
  const tx = useText()
  const { loaded, configured, busy, error } = useObservableSource(controller)
  usePendingUnload(saving)
  if (!loaded) return <SetupPage wordmarkSrc={wordmarkSrc}>{error ? <><InlineAlert>{error}</InlineAlert><div><Button onClick={controller.start}>{tx("translation.setup.view.reconnect")}</Button></div></> : <p role="status">{tx("translation.setup.view.checking.translation.settings")}</p>}</SetupPage>
  return <SetupPage wordmarkSrc={wordmarkSrc}>
    {children}
    {error && <InlineAlert>{error}</InlineAlert>}
    <div className="flex flex-wrap justify-end gap-2">
      <Button variant="ghost" disabled={busy || saving} onClick={() => onLeave(controller.skip)}>{tx("translation.setup.view.configure.later")}</Button>
      <Button disabled={busy || saving || !configured} onClick={() => onLeave(controller.continue)}>{tx("translation.setup.view.continue")}</Button>
    </div>
  </SetupPage>
}
