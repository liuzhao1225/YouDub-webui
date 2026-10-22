import { bindComponent, text, type Bindings, type JsonObject, type RouteProps, type SettingsSectionProps } from '../sdk'
import { Context } from 'cordis'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Dialog } from '@/components/ui/dialog'
import { Database, HardDrive, Info, Loader2, Plug, Puzzle, Settings2, Settings as SettingsIcon, X } from '@/lib/icons'
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
function Section({ title, children }: { title: ReactNode; children: ReactNode }) { return <SectionCard title={title}><div className="space-y-4 p-6">{children}</div></SectionCard> }
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
      setNotice(tx("settings.saved.restart.the.service.to.apply"))
      if (method === 'POST') { setSource(''); setRef('') }
      refresh()
    } catch (err) { setFailure(err instanceof Error ? err.message : String(err)) }
    finally { setBusy(false) }
  }
  return <>
    <form className="space-y-4 rounded-xl border border-border bg-card p-6" onSubmit={event => { event.preventDefault(); void mutate('/api/v2/extensions/install', 'POST', { source: source.trim(), ...(ref.trim() ? { ref: ref.trim() } : {}) }) }}>
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_10rem]">
        <div className="space-y-2"><Label htmlFor="extension-source">{tx("settings.github.repository.or.local.plugin.path")}</Label><Input id="extension-source" value={source} disabled={busy} onChange={event => setSource(event.target.value)} placeholder="https://github.com/owner/youdub-plugin" required /></div>
        <div className="space-y-2"><Label htmlFor="extension-ref">{tx("settings.version.commit")}</Label><Input id="extension-ref" value={ref} disabled={busy} onChange={event => setRef(event.target.value)} /></div>
      </div>
      <p className="text-xs text-muted-foreground">{tx("settings.installation.runs.repository.code.and.dependency.scripts.with.thi")}</p>
      <Button type="submit" disabled={busy || !source.trim()}>{busy ? <Loader2 className="animate-spin" /> : <Plug />}{tx("settings.install.extension")}</Button>
    </form>
    {error && <InlineAlert>{error}</InlineAlert>}{failure && <InlineAlert>{failure}</InlineAlert>}
    {notice && <p role="status" className="text-sm text-status-success-fg">{notice}</p>}
    {!!data?.items.length && <Section title={tx("settings.installed")}><div className="divide-y divide-border">{data.items.map(item => <div key={item.id} className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0 flex-1"><p className="break-words font-medium">{item.id} <span className="text-xs text-muted-foreground">{item.version}</span></p><p className="mt-1 break-all text-xs text-muted-foreground">{item.source}</p><p className="mt-2 text-xs">{item.active ? tx("settings.running") : item.enabled ? tx("settings.pending.start") : tx("settings.disabled")}{item.restartRequired ? tx("settings.restart.required") : ''}</p></div>
      <div className="flex gap-2"><Button variant="outline" size="sm" disabled={busy} onClick={() => void mutate(`/api/v2/extensions/${encodeURIComponent(item.id)}`, 'PATCH', { enabled: !item.enabled })}>{item.enabled ? tx("settings.disable") : tx("settings.enable")}</Button>{!item.enabled && !item.active && <Button variant="ghost" size="sm" disabled={busy} onClick={() => void mutate(`/api/v2/extensions/${encodeURIComponent(item.id)}`, 'DELETE')}>{tx("settings.uninstall")}</Button>}</div>
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
    { id: 'general', label: tx("settings.general"), icon: Settings2 },
    { id: 'models', label: tx("settings.models"), icon: Database },
    { id: 'resources', label: tx("settings.environment.models"), icon: HardDrive },
    { id: 'extensions', label: tx("settings.extensions"), icon: Puzzle },
    { id: 'about', label: tx("settings.about.updates"), icon: Info },
  ]
  const active = categories.find(item => item.id === section)
  const title = tx("settings.settings")
  return <Dialog.Root open onOpenChange={open => { if (!open && !saving && !guard.dialog) dismissDialog() }}>
    <Dialog.Portal>
      <Dialog.Backdrop />
      <Dialog.Popup initialFocus={closeButton} finalFocus={() => opener?.isConnected ? opener : true} className="h-[min(50rem,100%)] w-[min(50rem,100%)] overflow-hidden p-0" aria-describedby={undefined}>
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
          <Dialog.Title >{title}</Dialog.Title>
          <Dialog.Close disabled={saving} render={<Button ref={closeButton} variant="ghost" size="icon-sm" aria-label={tx("settings.close.settings")} />}><X /></Dialog.Close>
        </header>
        <div className="flex min-h-0 flex-1">
          <nav aria-label={tx("settings.settings.categories")} className="flex w-14 shrink-0 flex-col gap-1 border-r border-border bg-surface p-2 sm:w-48 sm:p-3">
            {categories.map(({ id, label, icon: Icon }) => <Tooltip key={id} content={label} side="right" className="sm:hidden"><Button disabled={saving} variant="ghost" aria-label={label} aria-current={section === id ? 'page' : undefined} onClick={() => replace(`/settings/${id}`)} className={cn('w-full justify-center px-0 sm:justify-start sm:gap-3 sm:px-3', section === id && 'bg-accent text-foreground')}><Icon className="shrink-0" /><span className="hidden sm:inline">{label}</span></Button></Tooltip>)}
          </nav>
          <section aria-label={active?.label ?? title} className="min-w-0 flex-1 space-y-6 overflow-y-auto overscroll-contain p-4 sm:p-6" key={section}>
            {section !== 'models' && <h1 >{active?.label ?? tx("settings.page.not.found")}</h1>}
        {section === 'general' && <Section title={tx("settings.appearance")}><div className="flex items-center justify-between gap-4"><span className="text-sm">{tx("settings.language")}</span><LanguageSwitcher /></div><div className="flex items-center justify-between gap-4"><span className="text-sm">{tx("settings.theme")}</span><ThemeToggle /></div></Section>}
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
