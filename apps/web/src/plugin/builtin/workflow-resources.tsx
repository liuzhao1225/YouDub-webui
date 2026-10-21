import { Check, Download, Loader2, RotateCcw } from 'lucide-react'
import { Link, text, type NodeTypeDefinition } from '../sdk'
import { useI18n, useText } from '@/lib/i18n'
import { formatBytes } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { InlineAlert } from '@/components/inline-alert'

import type { WorkflowResourcesResult } from '../runtime/workflow-resources'
export type { ResourceState } from '../runtime/workflow-resources'

export function WorkflowResources({ resources, types, disabled = false, hideReady = false }: { resources: WorkflowResourcesResult; types: NodeTypeDefinition[]; disabled?: boolean; hideReady?: boolean }) {
  const tx = useText(), { language } = useI18n()
  const state = resources.result
  const preparing = state?.status === 'preparing'
  const otherPreparing = state?.activePreparation?.status === 'preparing'
  const missing = state?.requirements?.filter((item) => !item.ready) ?? []
  const manual = missing.some((item) => !item.automatic)
  const configurationMissing = missing.some((item) => item.configurationRequired)
  const unconfigured = missing.filter(item => item.configurationRequired)
  const unconfiguredProvider = unconfigured.length === 1 ? types.find(type => type.providerId === unconfigured[0].providerId)?.provider : undefined
  const configurationName = unconfigured.length === 1 ? unconfiguredProvider?.capability === 'translation' ? tx('Translation service', '翻译服务', '翻訳サービス') : text(unconfiguredProvider?.label, language) || unconfigured[0].providerId : undefined
  if (hideReady && resources.ready && state?.status === 'ready' && !resources.checking && !resources.error && !state.error && !state.activePreparation) return null
  const statusLabel = (status: string) => ({
    pending: tx('Waiting', '等待中', '待機中'), running: tx('Preparing', '准备中', '準備中'),
    downloading: tx('Downloading', '下载中', 'ダウンロード中'), paused: tx('Paused', '已暂停', '一時停止中'),
    ready: tx('Ready', '已就绪', '準備完了'), failed: tx('Failed', '失败', '失敗'),
  })[status] ?? status
  const failure = state?.error && (typeof state.error === 'string' ? state.error : state.error.message)
  const status = <p className="flex items-center gap-2" role="status">
      {resources.ready ? <Check className="size-4 text-status-success-fg" /> : resources.checking || preparing ? <Loader2 className="size-4 animate-spin" /> : null}
      {resources.error ? tx('Could not check resource status', '无法获取资源状态', 'リソースの状態を確認できません') : preparing ? tx('Preparing required resources…', '正在准备所需资源…', '必要なリソースを準備中…') : resources.checking ? tx('Checking required resources…', '正在检查所需资源…', '必要なリソースを確認中…') : state?.status === 'ready' ? tx('Resources ready', '资源已就绪', 'リソースの準備完了') : state?.status === 'failed' ? tx('Resource preparation failed', '资源准备失败', 'リソースの準備に失敗しました') : configurationName ? tx(`${configurationName} not configured`, `${configurationName}未配置`, `${configurationName}が未設定`) : configurationMissing ? tx('Configure the required service', '请配置所需服务', '必要なサービスを設定してください') : tx('Required resources are missing', '缺少运行所需资源', '必要なリソースが不足しています')}
    </p>
  const details = state?.status !== 'ready' && <>
      {missing.map((item) => {
        const provider = types.find((type) => type.providerId === item.providerId)?.provider
        const label = text(provider?.label, language) || item.providerId
        const reason = item.reason === 'Provider connection is not configured.' ? tx('Configure the service URL, API key and model.', '请配置服务地址、API Key 和模型。', 'サービスURL、APIキー、モデルを設定してください。') : item.reason
        return <div key={`${item.providerId}:${item.model}`}><p className="font-medium">{label}{item.model ? ` · ${item.model}` : ''}</p>{reason && (!item.automatic || state?.status === 'failed' ? <p className="break-words text-xs text-muted-foreground">{reason}</p> : <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">{tx('Diagnostics', '诊断详情', '診断の詳細')}</summary><p className="mt-1 break-words">{reason}</p></details>)}</div>
      })}
      {state?.environment?.map((item) => <div key={item.id} className="text-xs"><p>{item.name} · {statusLabel(item.status)}</p>{item.detail && (item.status === 'failed' ? <p className="break-words text-status-danger-fg">{item.detail}</p> : <details className="text-muted-foreground"><summary className="cursor-pointer">{tx('Details', '准备详情', '準備の詳細')}</summary><p className="mt-1 break-words">{item.detail}</p></details>)}</div>)}
      {(preparing || state?.status === 'failed') && state?.models?.map((item) => <div key={item.id} className="space-y-1 text-xs"><p>{item.name} · {statusLabel(item.status)}</p>{item.total ? <><progress max={item.total} value={item.received ?? 0} aria-label={item.name} className="block h-1 w-full accent-primary" /><p className="text-muted-foreground">{formatBytes(item.received ?? 0)} / {formatBytes(item.total)}{item.status === 'downloading' && item.speed != null ? ` · ${formatBytes(item.speed)}/s` : ''}</p></> : null}{item.error && <p className="break-words text-status-danger-fg">{item.error}</p>}</div>)}
    </>
  const actions = resources.error ? <Button variant="outline" size={hideReady ? "sm" : "default"} disabled={disabled || resources.checking} onClick={resources.check}><RotateCcw />{tx('Check again', '重新检查', '再確認')}</Button> : state && state.status !== 'ready' && !preparing && !otherPreparing && (manual ? <>
      {configurationMissing ? <Link href="/settings/models" className="inline-flex text-sm text-link hover:underline">{tx('Configure service connection', '配置服务连接', 'サービス接続を設定')}</Link> : hideReady ? <Link href="/settings/resources" className="inline-flex text-sm text-link hover:underline">{tx('Environment & models', '环境与模型', '環境とモデル')}</Link> : <p className="text-xs text-muted-foreground">{tx('Complete the plugin setup above, then check again.', '请按上方插件要求完成配置后重新检查。', '上記のプラグイン設定を完了してから再確認してください。')}</p>}
      <Button variant="outline" size={hideReady ? "sm" : "default"} disabled={disabled || resources.checking} onClick={resources.check}><RotateCcw />{tx('Check again', '重新检查', '再確認')}</Button>
    </> : <Button variant="outline" size={hideReady ? "sm" : "default"} disabled={disabled || resources.checking} onClick={resources.prepare}><Download />{state.status === 'failed' ? tx('Retry preparation', '重试准备', '準備を再試行') : tx('Download required resources', '下载所需资源', '必要なリソースをダウンロード')}</Button>)
  return <section aria-label={tx('Workflow resources', '工作流资源', 'ワークフローのリソース')} className="space-y-3 text-sm">
    <div className={hideReady ? 'flex flex-wrap items-center gap-3' : 'space-y-3'}>{status}<div className={hideReady ? 'ml-auto flex flex-wrap items-center gap-3' : 'flex flex-wrap items-center gap-3'}>{actions}</div>
      {hideReady && details && <details className="contents text-xs text-muted-foreground"><summary className="cursor-pointer">{tx('Resource details', '资源详情', 'リソースの詳細')}</summary><div className="basis-full space-y-3">{details}</div></details>}
    </div>
    {failure && <InlineAlert>{failure}</InlineAlert>}
    {otherPreparing && <InlineAlert tone="warning">{tx('Another workflow is preparing resources. Its progress is checked automatically.', '另一工作流正在准备资源，完成后将自动更新状态。', '別のワークフローがリソースを準備中です。完了後に自動更新します。')}</InlineAlert>}
    {state?.activePreparation?.status === 'failed' && state.activePreparation.error && <InlineAlert>{state.activePreparation.error}</InlineAlert>}
    {resources.error && <InlineAlert>{resources.error}</InlineAlert>}

    {!hideReady && details}
  </section>
}
