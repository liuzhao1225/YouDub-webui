import { bindComponent, Link, text, type Bindings, type Catalog, type JsonObject, type RouteProps, type SettingsSectionProps } from '../sdk'
import { Context } from 'cordis'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { ArrowLeft, HardDrive, Info, Loader2, Plug, Puzzle, Settings2 } from 'lucide-react'
import { useI18n, useText } from '@/lib/i18n'
import { ThemeToggle } from '@/components/theme-toggle'
import { LanguageSwitcher } from '@/components/language-switcher'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { InlineAlert } from '@/components/inline-alert'
import { UpdateSettings } from '@/components/app-updates'
import { Page, PageHeader } from '@/components/page-layout'
import { SectionCard } from '@/components/section-card'
import { SidebarLink } from '@/components/sidebar-link'
import { BrandMark } from '@/components/brand/brand-mark'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'
import { ConnectionForm } from '@/components/connection-form'
import { SettingsResources } from '@/components/settings-resources'
import { useUnsavedChanges } from './workflow-guard'

type SettingsData = JsonObject & { connections?: { adapter: string }[]; plugins?: Record<string, JsonObject> }
type Extension = { id: string; version: string; source: string; installed: boolean; enabled: boolean; active: boolean; restartRequired: boolean }
type DirtyChange = (id: string, dirty: boolean) => void
type SettingsBindings = Bindings<'request' | 'useQuery' | 'useSlot' | 'useUpdates' | 'navigate' | 'replace' | 'blockNavigation'>
function Section({ title, children }: { title: ReactNode; children: ReactNode }) { return <SectionCard title={title}><div className="space-y-5 p-6">{children}</div></SectionCard> }
function ConnectionSection({ adapter, label, onDirtyChange, request }: { adapter: string; label: string; onDirtyChange: DirtyChange } & Bindings<'request'>) {
  const dirtyChanged = useCallback((dirty: boolean) => onDirtyChange(adapter, dirty), [adapter, onDirtyChange])
  return <Section title={label}><ConnectionForm request={request} adapter={adapter} onDirtyChange={dirtyChanged} /></Section>
}
function Connections({ request, useQuery, onDirtyChange }: Bindings<'request' | 'useQuery'> & { onDirtyChange: DirtyChange }) {
  const tx = useText()
  const { language } = useI18n()
  const { data: catalog, error: catalogError } = useQuery<Catalog>('/api/v2/catalog')
  const { data: settings, error } = useQuery<SettingsData>('/api/v2/settings')
  const remote = catalog?.providers.filter(item => item.execution === 'remote' || item.models?.some(model => typeof model === 'object' && model.devices?.includes('remote'))) ?? []
  const adapters = new Set([...remote.map(item => item.adapter ?? item.id), ...(settings?.connections?.map(item => item.adapter) ?? [])])
  return <>
    {error && <InlineAlert>{error}</InlineAlert>}{catalogError && <InlineAlert>{catalogError}</InlineAlert>}
    {!settings && !error && <p role="status" className="text-sm text-muted-foreground">{tx('Loading connections…', '正在读取连接…', '接続を読み込み中…')}</p>}
    {settings && catalog && [...adapters].map(adapter => <ConnectionSection key={adapter} adapter={adapter} request={request} onDirtyChange={onDirtyChange} label={adapter === 'openai' ? tx('OpenAI compatible', 'OpenAI 兼容', 'OpenAI 互換') : text(remote.find(item => (item.adapter ?? item.id) === adapter)?.label, language) || adapter} />)}
    {settings && catalog && !adapters.size && <p className="text-sm text-muted-foreground">{tx('No service connections.', '暂无服务连接。', 'サービス接続はありません。')}</p>}
  </>
}
function Extensions({ request, useQuery, onDirtyChange }: Bindings<'request' | 'useQuery'> & { onDirtyChange: DirtyChange }) {
  const tx = useText()
  const { data, error, refresh } = useQuery<{ items: Extension[] }>('/api/v2/extensions')
  const [source, setSource] = useState(''), [ref, setRef] = useState('')
  const [busy, setBusy] = useState(false), [failure, setFailure] = useState(''), [notice, setNotice] = useState('')
  useEffect(() => onDirtyChange('extension-install', Boolean(source || ref)), [source, ref, onDirtyChange])
  async function mutate(path: string, method: string, body?: JsonObject) {
    setBusy(true); setFailure(''); setNotice('')
    try {
      await request(path, { method, ...(body ? { body: JSON.stringify(body) } : {}) })
      setNotice(tx('Saved. Restart the service to apply.', '已保存，重启服务后生效。', '保存しました。サービスの再起動後に反映されます。'))
      if (method === 'POST') { setSource(''); setRef('') }
      refresh()
    } catch (err) { setFailure(err instanceof Error ? err.message : String(err)) }
    finally { setBusy(false) }
  }
  return <>
    <form className="space-y-4 rounded-2xl border border-border bg-card p-6 shadow-card" onSubmit={event => { event.preventDefault(); void mutate('/api/v2/extensions/install', 'POST', { source: source.trim(), ...(ref.trim() ? { ref: ref.trim() } : {}) }) }}>
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_10rem]">
        <div className="space-y-2"><Label htmlFor="extension-source">{tx('GitHub repository or local plugin path', 'GitHub 仓库或本地插件路径', 'GitHub リポジトリまたはローカルパス')}</Label><Input id="extension-source" value={source} disabled={busy} onChange={event => setSource(event.target.value)} placeholder="https://github.com/owner/youdub-plugin" required /></div>
        <div className="space-y-2"><Label htmlFor="extension-ref">{tx('Version / commit', '版本 / commit', 'バージョン / commit')}</Label><Input id="extension-ref" value={ref} disabled={busy} onChange={event => setRef(event.target.value)} /></div>
      </div>
      <p className="text-xs text-muted-foreground">{tx('Installation runs repository code and dependency scripts with this machine’s permissions.', '安装会运行仓库代码和依赖安装脚本，并使用本机权限。', 'インストールはこの端末の権限でリポジトリのコードと依存スクリプトを実行します。')}</p>
      <Button type="submit" disabled={busy || !source.trim()}>{busy ? <Loader2 className="animate-spin" /> : <Plug />}{tx('Install extension', '安装扩展', '拡張機能をインストール')}</Button>
    </form>
    {error && <InlineAlert>{error}</InlineAlert>}{failure && <InlineAlert>{failure}</InlineAlert>}
    {notice && <p role="status" className="text-sm text-status-success-fg">{notice}</p>}
    {!!data?.items.length && <Section title={tx('Installed', '已安装', 'インストール済み')}><div className="divide-y divide-border">{data.items.map(item => <div key={item.id} className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0 flex-1"><p className="break-words font-medium">{item.id} <span className="text-xs text-muted-foreground">{item.version}</span></p><p className="mt-1 break-all text-xs text-muted-foreground">{item.source}</p><p className="mt-2 text-xs">{item.active ? tx('Running', '运行中', '実行中') : item.enabled ? tx('Pending start', '待启动', '起動待ち') : tx('Disabled', '已停用', '無効')}{item.restartRequired ? tx(' · restart required', ' · 重启后生效', ' · 再起動が必要') : ''}</p></div>
      <div className="flex gap-2"><Button variant="outline" size="sm" disabled={busy} onClick={() => void mutate(`/api/v2/extensions/${encodeURIComponent(item.id)}`, 'PATCH', { enabled: !item.enabled })}>{item.enabled ? tx('Disable', '停用', '無効化') : tx('Enable', '启用', '有効化')}</Button>{!item.enabled && !item.active && <Button variant="ghost" size="sm" disabled={busy} onClick={() => void mutate(`/api/v2/extensions/${encodeURIComponent(item.id)}`, 'DELETE')}>{tx('Uninstall', '卸载', 'アンインストール')}</Button>}</div>
    </div>)}</div></Section>}
  </>
}
function ExtensionSection({ id, label, component: Component, settings, refresh, request, onDirtyChange }: { id: string; label: string; component: React.ComponentType<SettingsSectionProps>; settings: SettingsData; refresh(): void; onDirtyChange: DirtyChange } & Bindings<'request'>) {
  const dirtyChanged = useCallback((dirty: boolean) => onDirtyChange(id, dirty), [id, onDirtyChange])
  return <Section title={label}><Component settings={settings.plugins?.[id] ?? {}} onDirtyChange={dirtyChanged} save={async patch => {
    await request('/api/v2/settings', { method: 'PATCH', body: JSON.stringify({ plugin: { id, config: patch } }) })
    dirtyChanged(false); refresh()
  }} /></Section>
}
function ExtensionSettings({ request, useQuery, useSlot, onDirtyChange }: Bindings<'request' | 'useQuery' | 'useSlot'> & { onDirtyChange: DirtyChange }) {
  const { language } = useI18n()
  const sections = useSlot('settings.sections')
  const { data, error, refresh } = useQuery<SettingsData>('/api/v2/settings')
  return <><Extensions request={request} useQuery={useQuery} onDirtyChange={onDirtyChange} />{error && <InlineAlert>{error}</InlineAlert>}{data && sections.map(({ id, label, component }) => <ExtensionSection key={id} request={request} id={id} label={text(label, language) || id} component={component} settings={data} refresh={refresh} onDirtyChange={onDirtyChange} />)}</>
}
function Settings({ params, returnTo, request, useQuery, useSlot, useUpdates, navigate, replace, blockNavigation }: SettingsBindings & RouteProps) {
  const tx = useText()
  const section = params.section ?? 'general'
  const [dirty, setDirty] = useState<Record<string, boolean>>({})
  const onDirtyChange = useCallback<DirtyChange>((id, value) => setDirty(current => current[id] === value ? current : { ...current, [id]: value }), [])
  const guard = useUnsavedChanges(blockNavigation, Object.values(dirty).some(Boolean))
  useEffect(() => { if (!params.section) replace('/settings/general') }, [params.section, replace])
  const back = returnTo?.startsWith('/') && !returnTo.startsWith('//') && !/^\/settings(?:[/?#]|$)/.test(returnTo) ? returnTo : '/'
  const categories = [
    { id: 'general', label: tx('General', '通用', '一般'), icon: Settings2 },
    { id: 'connections', label: tx('Connections', '服务连接', 'サービス接続'), icon: Plug },
    { id: 'resources', label: tx('Environment & models', '环境与模型', '環境とモデル'), icon: HardDrive },
    { id: 'extensions', label: tx('Extensions', '扩展', '拡張機能'), icon: Puzzle },
    { id: 'about', label: tx('About & updates', '关于与更新', 'アプリ情報と更新'), icon: Info },
  ]
  const active = categories.find(item => item.id === section)
  const title = tx('Settings', '设置', '設定')
  const returnLabel = tx('Back', '返回', '戻る')
  return <div className="flex h-dvh min-h-0 bg-background">
    <aside className="hidden w-[248px] shrink-0 flex-col border-r border-border bg-surface lg:flex">
      <div className="flex h-16 shrink-0 items-center px-5"><BrandMark wordmark className="h-7" /></div>
      <div className="px-3"><Button nativeButton={false} render={<Link href={back} />} variant="ghost" className="w-full justify-start"><ArrowLeft />{returnLabel}</Button></div>
      <h2 className="px-6 pt-6 pb-3 text-xs font-medium text-subtle-foreground">{title}</h2>
      <nav aria-label={title} className="flex flex-col gap-0.5 px-3">{categories.map(item => <SidebarLink key={item.id} href={`/settings/${item.id}`} label={item.label} icon={item.icon} active={section === item.id} />)}</nav>
    </aside>
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="flex items-center gap-3 border-b border-border p-4 lg:hidden"><Button nativeButton={false} render={<Link href={back} />} variant="ghost" size="icon" aria-label={returnLabel}><ArrowLeft /></Button><Select value={section} onValueChange={value => { if (value) navigate(`/settings/${value}`) }}><SelectTrigger aria-label={title}>{active?.label ?? title}</SelectTrigger><SelectContent>{categories.map(item => <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>)}</SelectContent></Select></header>
      <main className="min-h-0 flex-1 overflow-y-auto"><Page as="div"><PageHeader title={active?.label ?? tx('Page not found', '页面不存在', 'ページが見つかりません')} />
        {section === 'general' && <Section title={tx('Appearance', '外观', '表示')}><div className="flex items-center justify-between gap-4"><span className="text-sm">{tx('Language', '语言', '言語')}</span><LanguageSwitcher /></div><div className="flex items-center justify-between gap-4"><span className="text-sm">{tx('Theme', '主题', 'テーマ')}</span><ThemeToggle /></div></Section>}
        {section === 'connections' && <Connections request={request} useQuery={useQuery} onDirtyChange={onDirtyChange} />}
        {section === 'resources' && <SettingsResources request={request} />}
        {section === 'extensions' && <ExtensionSettings request={request} useQuery={useQuery} useSlot={useSlot} onDirtyChange={onDirtyChange} />}
        {section === 'about' && <UpdateSettings useUpdates={useUpdates} />}
      </Page></main>
    </div>{guard.dialog}
  </div>
}
export const name = 'client-settings'
export const inject = ['slots', 'apiClient', 'navigation']
export function apply(ctx: Context) {
  const component = bindComponent(ctx, ['request', 'useQuery', 'useSlot', 'useUpdates', 'navigate', 'replace', 'blockNavigation'], Settings)
  ctx.effect(() => ctx.slots.register('shell.routes', { id: 'settings', path: '/settings', component, access: 'authenticated', layout: 'standalone' }))
  ctx.effect(() => ctx.slots.register('shell.routes', { id: 'settings-section', path: '/settings/:section', component, access: 'authenticated', layout: 'standalone' }))
  ctx.effect(() => ctx.slots.register('shell.navigation', { id: 'settings', routeId: 'settings', label: { default: 'Settings', translations: { zh: '设置', ja: '設定' } }, order: 30, placement: 'footer', icon: Settings2 }))
}
