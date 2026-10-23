import { useState, type ReactNode } from 'react'
import { BrandMark } from './brand/brand-mark'
import { Button } from './ui/button'
import { TranslationSetupController } from '@/runtime/onboarding'
import { useObservableSource, usePendingUnload } from '@/plugin/view-hooks'
import { useText } from '@/lib/i18n'
import { PageContainer } from './page-layout'
import { InlineAlert } from './inline-alert'

export interface TranslationModelsProps {
  request: TranslationSetupController['request']
  onReadyChange(configured: boolean): void
  onDirtyChange(dirty: boolean): void
  onBusyChange(busy: boolean): void
}

/** Original first-run page shared by the web product and Harness composition. */
export function TranslationSetupView({ controller, renderModels, wordmarkSrc, onLeave }: {
  controller: TranslationSetupController
  renderModels(props: TranslationModelsProps): ReactNode
  wordmarkSrc?: string
  onLeave?: (action: () => void) => void
}) {
  const tx = useText()
  const { loaded, configured, busy, error } = useObservableSource(controller)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  usePendingUnload(dirty || saving)
  if (!loaded) return <PageContainer as="main" className="max-w-3xl space-y-6 pt-[var(--page-top)] pb-12">{error ? <><p role="alert">{error}</p><Button onClick={controller.start}>{tx("translation.setup.view.reconnect")}</Button></> : <p role="status">{tx("translation.setup.view.checking.translation.settings")}</p>}</PageContainer>
  return <PageContainer as="main" className="max-w-3xl space-y-6 pt-[var(--page-top)] pb-12">
    <BrandMark animated wordmark wordmarkSrc={wordmarkSrc} className="h-7" />
    {renderModels({ request: controller.request, onReadyChange: controller.setConfigured, onDirtyChange: setDirty, onBusyChange: setSaving })}
    {error && <InlineAlert>{error}</InlineAlert>}
    <div className="flex justify-end gap-3">
      <Button variant="ghost" disabled={busy || dirty || saving} onClick={() => onLeave ? onLeave(controller.skip) : controller.skip()}>{tx("translation.setup.view.configure.later")}</Button>
      <Button disabled={busy || dirty || saving || !configured} onClick={() => onLeave ? onLeave(controller.continue) : controller.continue()}>{tx("translation.setup.view.continue")}</Button>
    </div>
  </PageContainer>
}
