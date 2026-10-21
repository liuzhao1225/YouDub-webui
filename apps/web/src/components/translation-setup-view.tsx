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
export function TranslationSetupView({ controller, renderModels, wordmarkSrc }: {
  controller: TranslationSetupController
  renderModels(props: TranslationModelsProps): ReactNode
  wordmarkSrc?: string
}) {
  const tx = useText()
  const { loaded, configured, busy, error } = useObservableSource(controller)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  usePendingUnload(dirty || saving)
  if (!loaded) return <PageContainer as="main" className="max-w-3xl space-y-6 py-12">{error ? <><p role="alert">{error}</p><Button onClick={controller.start}>{tx('Reconnect', '重新连接', '再接続')}</Button></> : <p role="status">{tx('Checking translation settings…', '检查翻译服务配置…', '翻訳サービスの設定を確認中…')}</p>}</PageContainer>
  return <PageContainer as="main" className="max-w-3xl space-y-6 py-12">
    <BrandMark wordmark wordmarkSrc={wordmarkSrc} className="h-7" />
    {renderModels({ request: controller.request, onReadyChange: controller.setConfigured, onDirtyChange: setDirty, onBusyChange: setSaving })}
    {error && <InlineAlert>{error}</InlineAlert>}
    <div className="flex justify-end gap-3">
      <Button variant="ghost" disabled={busy || dirty || saving} onClick={controller.skip}>{tx('Configure later', '稍后配置', '後で設定')}</Button>
      <Button disabled={busy || dirty || saving || !configured} onClick={controller.continue}>{tx('Continue', '继续', '続行')}</Button>
    </div>
  </PageContainer>
}
