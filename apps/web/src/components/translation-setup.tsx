import { useEffect, useState, type ReactNode } from 'react'
import { BrandMark } from './brand/brand-mark'
import { Button } from './ui/button'
import { TranslationSetupController } from '@/runtime/onboarding'
import { useObservableSource } from '@/plugin/web-react'
import { LanguageProvider, useText } from '@/lib/i18n'
import { PageContainer } from './page-layout'
import { ConnectionForm } from './connection-form'

export function TranslationSetup({ children }: { children: ReactNode }) {
  const [controller] = useState(() => new TranslationSetupController())
  const { ready } = useObservableSource(controller)
  useEffect(() => { controller.start(); return controller.stop }, [controller])
  if (ready) return children
  return <LanguageProvider><TranslationSetupView controller={controller} /></LanguageProvider>
}

function TranslationSetupView({ controller }: { controller: TranslationSetupController }) {
  const tx = useText()
  const { settings, busy, error } = useObservableSource(controller)
  if (!settings) return <PageContainer as="main" className="max-w-xl space-y-6 py-12">{error ? <><p role="alert">{error}</p><Button onClick={controller.start}>{tx('Reconnect', '重新连接', '再接続')}</Button></> : <p role="status">{tx('Checking translation settings…', '检查翻译服务配置…', '翻訳サービスの設定を確認中…')}</p>}</PageContainer>
  return <PageContainer as="main" className="max-w-xl space-y-6 py-12">
    <BrandMark wordmark className="h-7" />
    <div className="space-y-2"><h1 className="text-xl font-semibold">{tx('Configure translation', '配置翻译服务', '翻訳サービスを設定')}</h1><p className="text-sm text-muted-foreground">{tx('Translation sends subtitle text to this OpenAI-compatible service. A connection test sends a short test message.', '翻译会向此 OpenAI 兼容服务发送字幕文本；测试连接会发送一句简短测试文本。', '翻訳時に字幕テキストをこの OpenAI 互換サービスへ送信します。接続テストでは短いテスト文を送信します。')}</p></div>
    <div className="space-y-4 rounded-2xl border border-border bg-card p-6">
      <ConnectionForm controller={controller.connection} disabled={busy} error={error} onSubmit={controller.save}
        submitLabel={tx('Test connection and continue', '测试连接并继续', '接続をテストして続行')}
        secondaryAction={{ label: tx('Configure later', '稍后配置', '後で設定'), onClick: controller.skip }} />
      <p className="text-xs text-muted-foreground">{tx('You can continue now and configure the connection in Settings before translating.', '可以稍后在设置中配置连接，完成后再开始翻译任务。', '今は続行できます。翻訳を始める前に設定で接続を設定してください。')}</p>
    </div>
  </PageContainer>
}
