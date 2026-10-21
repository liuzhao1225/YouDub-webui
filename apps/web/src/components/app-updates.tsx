import { ArrowDownToLine, Loader2 } from 'lucide-react'
import { Link, type Bindings } from '@/plugin/sdk'
export { UpdateProvider } from '@/plugin/sdk'
import { useText } from '@/lib/i18n'
import { Button } from './ui/button'
import { InlineAlert } from './inline-alert'
import { SectionCard } from './section-card'

export function UpdateNotice({ hidden = false, useUpdates }: { hidden?: boolean } & Bindings<'useUpdates'>) {
  const updates = useUpdates(), tx = useText()
  if (hidden || !updates) return null
  const available = updates.result?.available
  if (updates.error) return <div className="border-b border-border px-5 py-3 text-sm text-status-warning-fg"><Link href="/settings">{tx('Update check failed. Open settings to retry.', '检查更新失败，前往设置重试。', '更新の確認に失敗しました。設定から再試行してください。')}</Link></div>
  if (!available) return null
  return <div role="status" className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border bg-accent/50 px-5 py-3 text-sm">
    <span className="flex items-center gap-2"><span className="size-2 rounded-full bg-brand-blue" />{tx('New version', '发现新版本', '新しいバージョン')} {available.version}</span>
    <a className="font-medium text-primary underline underline-offset-4" href={available.download} target="_blank" rel="noreferrer">{tx('Download update', '下载更新', '更新をダウンロード')}</a>
    <a className="text-muted-foreground underline underline-offset-4" href={available.url} target="_blank" rel="noreferrer">{tx('Release notes', '更新说明', 'リリースノート')}</a>
  </div>
}

export function UpdateSettings({ useUpdates }: Bindings<'useUpdates'>) {
  const updates = useUpdates(), tx = useText()
  if (!updates) return null
  const available = updates.result?.available
  return <SectionCard title={tx('Software update', '软件更新', 'ソフトウェア更新')}>
    <div className="space-y-4 p-6">
      {updates.info && <p className="text-sm">YouDub {updates.info.currentVersion}</p>}
      {updates.info?.supported && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={updates.info.automatic} disabled={updates.busy} onChange={event => updates.setAutomatic(event.target.checked)} />{tx('Check automatically every hour', '每小时自动检查更新', '毎時間、自動的に更新を確認')}</label>}
      {updates.error && <InlineAlert>{updates.error}</InlineAlert>}
      {updates.info && !updates.info.supported ? <p className="text-sm text-muted-foreground">{tx('No desktop package is published for this platform.', '当前平台暂无桌面安装包。', 'このプラットフォームのデスクトップ版は未公開です。')}</p> : <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" disabled={updates.busy} onClick={updates.check}>{updates.busy && <Loader2 className="animate-spin" />}{tx('Check for updates', '检查更新', '更新を確認')}</Button>
        {available && <Button nativeButton={false} render={<a href={available.download} target="_blank" rel="noreferrer" />}><ArrowDownToLine />{tx('Download', '下载', 'ダウンロード')} {available.version}</Button>}
        {!updates.busy && updates.result && !available && <span role="status" className="text-sm text-muted-foreground">{tx('No newer version available', '当前没有新版本', '新しいバージョンはありません')}</span>}
      </div>}
      {available && <div className="flex gap-4 text-sm text-muted-foreground"><a className="underline underline-offset-4" href={available.url} target="_blank" rel="noreferrer">{tx('Release notes', '更新说明', 'リリースノート')}</a><a className="underline underline-offset-4" href={available.checksum} target="_blank" rel="noreferrer">SHA-256</a></div>}
    </div>
  </SectionCard>
}
