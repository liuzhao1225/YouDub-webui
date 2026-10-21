import { bindComponent, text, type Bindings, type JsonObject, type RouteProps, type SettingsSectionProps } from '../sdk'
import { Context } from 'cordis'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Dialog } from '@base-ui/react/dialog'
import { Database, HardDrive, Info, Loader2, Plug, Puzzle, Settings2, Settings as SettingsIcon, X } from 'lucide-react'
import { useI18n, useText } from '@/lib/i18n'
import { ThemeToggle } from '@/components/theme-toggle'
import { LanguageSwitcher } from '@/components/language-switcher'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { InlineAlert } from '@/components/inline-alert'
import { UpdateSettings } from '@/components/app-updates'
import { SectionCard } from '@/components/section-card'
import { Tooltip } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { ModelsSettings } from '@/components/models-settings'
import { SettingsResources } from '@/components/settings-resources'
import { useUnsavedChanges } from './workflow-guard'

type SettingsData = JsonObject & { connections?: { adapter: string }[]; plugins?: Record<string, JsonObject> }
type Extension = { id: string; version: string; source: string; installed: boolean; enabled: boolean; active: boolean; restartRequired: boolean }
type DirtyChange = (id: string, dirty: boolean) => void
type SettingsBindings = Bindings<'request' | 'useQuery' | 'useSlot' | 'useUpdates' | 'replace' | 'dismissDialog' | 'blockNavigation'>
function Section({ title, children }: { title: ReactNode; children: ReactNode }) { return <SectionCard title={title}><div className="space-y-5 p-6">{children}</div></SectionCard> }
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
function Settings({ params, request, useQuery, useSlot, useUpdates, replace, dismissDialog, blockNavigation }: SettingsBindings & RouteProps) {
  const tx = useText()
  const section = params.section === 'connections' ? 'models' : params.section ?? 'general'
  const [dirty, setDirty] = useState<{ section: string; fields: Record<string, boolean> }>({ section, fields: {} })
  if (dirty.section !== section) setDirty({ section, fields: {} })
  const onDirtyChange = useCallback<DirtyChange>((id, value) => setDirty(current => current.fields[id] === value ? current : { section, fields: { ...current.fields, [id]: value } }), [section])
  const onModelsDirtyChange = useCallback((value: boolean) => onDirtyChange('models', value), [onDirtyChange])
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const onModelsBusyChange = useCallback((value: boolean) => { savingRef.current = value; setSaving(value) }, [])
  const blockDialog = useCallback<SettingsBindings['blockNavigation']>(handler => blockNavigation(path => savingRef.current ? Promise.resolve(false) : handler(path), 'dialog'), [blockNavigation])
  const guard = useUnsavedChanges(blockDialog, dirty.section === section && Object.values(dirty.fields).some(Boolean))
  const closeButton = useRef<HTMLButtonElement>(null)
  const [opener] = useState(() => document.activeElement instanceof HTMLElement ? document.activeElement : null)
  useEffect(() => { if (!params.section) replace('/settings/general'); else if (params.section === 'connections') replace('/settings/models') }, [params.section, replace])
  const categories = [
    { id: 'general', label: tx('General', '通用', '一般'), icon: Settings2 },
    { id: 'models', label: tx('Models', '模型', 'モデル'), icon: Database },
    { id: 'resources', label: tx('Environment & models', '环境与模型', '環境とモデル'), icon: HardDrive },
    { id: 'extensions', label: tx('Extensions', '扩展', '拡張機能'), icon: Puzzle },
    { id: 'about', label: tx('About & updates', '关于与更新', 'アプリ情報と更新'), icon: Info },
  ]
  const active = categories.find(item => item.id === section)
  const title = tx('Settings', '设置', '設定')
  return <Dialog.Root open onOpenChange={open => { if (!open && !saving && !guard.dialog) dismissDialog() }}>
    <Dialog.Portal>
      <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/55 backdrop-blur-sm" />
      <Dialog.Popup initialFocus={closeButton} finalFocus={() => opener?.isConnected ? opener : true} className="fixed top-1/2 left-1/2 z-50 flex h-[min(50rem,calc(100dvh-3rem))] w-[min(50rem,calc(100vw-3rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-border bg-background text-foreground shadow-float outline-none max-sm:h-dvh max-sm:w-full max-sm:rounded-none" aria-describedby={undefined}>
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-5">
          <Dialog.Title className="text-base font-semibold">{title}</Dialog.Title>
          <Dialog.Close disabled={saving} render={<Button ref={closeButton} variant="ghost" size="icon-sm" aria-label={tx('Close settings', '关闭设置', '設定を閉じる')} />}><X /></Dialog.Close>
        </header>
        <div className="flex min-h-0 flex-1">
          <nav aria-label={tx('Settings categories', '设置分类', '設定カテゴリー')} className="flex w-14 shrink-0 flex-col gap-1 border-r border-border bg-surface p-2 sm:w-48 sm:p-3">
            {categories.map(({ id, label, icon: Icon }) => <Tooltip key={id} content={label} side="right" className="sm:hidden"><Button disabled={saving} variant="ghost" aria-label={label} aria-current={section === id ? 'page' : undefined} onClick={() => replace(`/settings/${id}`)} className={cn('w-full justify-center px-0 sm:justify-start sm:gap-3 sm:px-3', section === id && 'bg-accent text-foreground')}><Icon className="shrink-0" /><span className="hidden sm:inline">{label}</span></Button></Tooltip>)}
          </nav>
          <section aria-label={active?.label ?? title} className="min-w-0 flex-1 space-y-6 overflow-y-auto overscroll-contain p-4 sm:p-6" key={section}>
            {section !== 'models' && <h1 className="text-lg font-semibold">{active?.label ?? tx('Page not found', '页面不存在', 'ページが見つかりません')}</h1>}
        {section === 'general' && <Section title={tx('Appearance', '外观', '表示')}><div className="flex items-center justify-between gap-4"><span className="text-sm">{tx('Language', '语言', '言語')}</span><LanguageSwitcher /></div><div className="flex items-center justify-between gap-4"><span className="text-sm">{tx('Theme', '主题', 'テーマ')}</span><ThemeToggle /></div></Section>}
        {section === 'models' && <ModelsSettings request={request} onDirtyChange={onModelsDirtyChange} onBusyChange={onModelsBusyChange} />}
        {section === 'resources' && <SettingsResources request={request} />}
        {section === 'extensions' && <ExtensionSettings request={request} useQuery={useQuery} useSlot={useSlot} onDirtyChange={onDirtyChange} />}
        {section === 'about' && <UpdateSettings useUpdates={useUpdates} />}
          </section>
        </div>
        {guard.dialog}
      </Dialog.Popup>
    </Dialog.Portal>
  </Dialog.Root>
}
export const name = 'client-settings'
export const inject = ['slots', 'apiClient', 'navigation']
export function apply(ctx: Context) {
  const component = bindComponent(ctx, ['request', 'useQuery', 'useSlot', 'useUpdates', 'replace', 'dismissDialog', 'blockNavigation'], Settings)
  ctx.effect(() => ctx.slots.register('shell.routes', { id: 'settings', path: '/settings', component, access: 'authenticated', layout: 'dialog' }))
  ctx.effect(() => ctx.slots.register('shell.routes', { id: 'settings-section', path: '/settings/:section', component, access: 'authenticated', layout: 'dialog' }))
  ctx.effect(() => ctx.slots.register('shell.navigation', { id: 'settings', routeId: 'settings', label: { default: 'Settings', translations: { zh: '设置', ja: '設定' } }, order: 30, placement: 'footer', icon: SettingsIcon }))
}
