import { ArrowDownToLine, Loader2 } from '@/lib/icons'
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
  if (updates.error) return <div className="border-b border-border px-4 py-3 text-sm text-status-warning-fg"><Link href="/settings/about">{tx("app.updates.update.check.failed.open.settings.to.retry")}</Link></div>
  if (!available) return null
  return <div role="status" className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border bg-accent/50 px-4 py-3 text-sm">
    <span className="flex items-center gap-2"><span className="size-2 rounded-full bg-brand-blue" />{tx("app.updates.new.version")} {available.version}</span>
    <a className="font-medium text-primary underline underline-offset-4" href={available.download} target="_blank" rel="noreferrer">{tx("app.updates.download.update")}</a>
    <a className="text-muted-foreground underline underline-offset-4" href={available.url} target="_blank" rel="noreferrer">{tx("app.updates.release.notes")}</a>
  </div>
}

export function UpdateSettings({ useUpdates }: Bindings<'useUpdates'>) {
  const updates = useUpdates(), tx = useText()
  if (!updates) return null
  const available = updates.result?.available
  return <SectionCard title={tx("app.updates.software.update")}>
    <div className="space-y-4 p-6">
      {updates.info && <p className="text-sm">YouDub {updates.info.currentVersion}</p>}
      {updates.info?.supported && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={updates.info.automatic} disabled={updates.busy} onChange={event => updates.setAutomatic(event.target.checked)} />{tx("app.updates.check.automatically.every.hour")}</label>}
      {updates.error && <InlineAlert>{updates.error}</InlineAlert>}
      {updates.info && !updates.info.supported ? <p className="text-sm text-muted-foreground">{tx("app.updates.no.desktop.package.is.published.for.this.platform")}</p> : <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" disabled={updates.busy} onClick={updates.check}>{updates.busy && <Loader2 className="animate-spin" />}{tx("app.updates.check.for.updates")}</Button>
        {available && <Button nativeButton={false} render={<a href={available.download} target="_blank" rel="noreferrer" />}><ArrowDownToLine />{tx("app.updates.download")} {available.version}</Button>}
        {!updates.busy && updates.result && !available && <span role="status" className="text-sm text-muted-foreground">{tx("app.updates.no.newer.version.available")}</span>}
      </div>}
      {available && <div className="flex gap-4 text-sm text-muted-foreground"><a className="underline underline-offset-4" href={available.url} target="_blank" rel="noreferrer">{tx("app.updates.release.notes")}</a><a className="underline underline-offset-4" href={available.checksum} target="_blank" rel="noreferrer">SHA-256</a></div>}
    </div>
  </SectionCard>
}
