import { useEffect, useState, type ReactNode } from 'react'
import { BrandMark } from './brand/brand-mark'
import { Button } from './ui/button'
import { TranslationSetupController } from '@/runtime/onboarding'
import { useObservableSource, usePendingUnload } from '@/plugin/web-react'
import { LanguageProvider, useText } from '@/lib/i18n'
import { PageContainer } from './page-layout'
import { ModelsSettings } from './models-settings'
import { InlineAlert } from './inline-alert'

export function TranslationSetup({ children }: { children: ReactNode }) {
  const [controller] = useState(() => new TranslationSetupController())
  const { ready } = useObservableSource(controller)
  useEffect(() => { controller.start(); return controller.stop }, [controller])
  if (ready) return children
  return <LanguageProvider><TranslationSetupView controller={controller} /></LanguageProvider>
}

function TranslationSetupView({ controller }: { controller: TranslationSetupController }) {
  const tx = useText()
  const { loaded, configured, busy, error } = useObservableSource(controller)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  usePendingUnload(dirty || saving)
  if (!loaded) return <PageContainer as="main" className="max-w-3xl space-y-6 py-12">{error ? <><p role="alert">{error}</p><Button onClick={controller.start}>{tx('Reconnect', '重新连接', '再接続')}</Button></> : <p role="status">{tx('Checking translation settings…', '检查翻译服务配置…', '翻訳サービスの設定を確認中…')}</p>}</PageContainer>
  return <PageContainer as="main" className="max-w-3xl space-y-6 py-12">
    <BrandMark wordmark className="h-7" />
    <ModelsSettings request={controller.request} onReadyChange={controller.setConfigured} onDirtyChange={setDirty} onBusyChange={setSaving} />
    {error && <InlineAlert>{error}</InlineAlert>}
    <div className="flex justify-end gap-3">
      <Button variant="ghost" disabled={busy || dirty || saving} onClick={controller.skip}>{tx('Configure later', '稍后配置', '後で設定')}</Button>
      <Button disabled={busy || dirty || saving || !configured} onClick={controller.continue}>{tx('Continue', '继续', '続行')}</Button>
    </div>
  </PageContainer>
}
