import { Context } from 'cordis'
import { useState } from 'react'
import { LogOut, PanelLeftClose, PanelLeftOpen, Plus } from 'lucide-react'
import { Link, matchRoute, type RouteEntry, text, useClient, useObservable, usePathname, useSlot } from '../sdk'
import { restoreTheme, ThemeProvider } from '@/lib/theme'
import { LanguageProvider, useI18n } from '@/lib/i18n'
import { LanguageSwitcher } from '@/components/language-switcher'
import { ThemeToggle } from '@/components/theme-toggle'
import { Button } from '@/components/ui/button'
import { InlineAlert } from '@/components/inline-alert'

export function resolveRoute(routes: RouteEntry[], path: string, authenticated: boolean) {
  // Static segments take precedence over parameters, independently of plugin
  // installation order (for example /tasks/help before /tasks/:id).
  const specificity = (pattern: string) => pattern.split('/').map((part) => part.startsWith(':') ? '0' : '1').join('')
  return routes.map((route) => ({ route, params: matchRoute(path, route.path) }))
    .filter((item) => item.params && (item.route.access === 'public' || authenticated))
    .sort((a, b) => specificity(b.route.path).localeCompare(specificity(a.route.path)))[0]
}
function Shell() {
  const client = useClient()
  const session = useObservable(client.session)
  const path = usePathname()
  const routes = useSlot('shell.routes')
  const navigation = useSlot('shell.navigation')
  const { language, t } = useI18n()
  const [collapsed, setCollapsed] = useState(false)
  const [error, setError] = useState('')
  if (session.status === 'error') return <main className="mx-auto max-w-xl p-8"><InlineAlert>{session.error}</InlineAlert></main>
  if (session.status === 'loading') return <div role="status" className="p-8 text-sm text-muted-foreground">{t.auth.sessionLoading}</div>
  const match = resolveRoute(routes, path, session.status === 'authenticated')
  const Page = match?.route.component
  const content = Page ? <Page key={`${match.route.id}:${path}`} params={match.params!} /> : <div className="p-8"><h1 className="text-xl font-semibold">404</h1><p className="mt-2 text-muted-foreground">{language === 'zh' ? '当前插件组合未提供这个页面。' : 'This page is not provided by the active plugins.'}</p></div>
  if (session.status === 'anonymous') return content
  return <div className={collapsed ? 'min-h-screen lg:pl-[72px]' : 'min-h-screen lg:pl-[248px]'}>
    <aside className={`fixed inset-y-0 left-0 z-40 hidden flex-col border-r border-border bg-surface lg:flex ${collapsed ? 'w-[72px]' : 'w-[248px]'}`}>
      <div className="flex h-16 items-center justify-between gap-2 px-4">
        <Link href="/" aria-label="YouDub"><img src={collapsed ? '/youdub-icon.svg' : '/youdub-logo.svg'} alt="YouDub" className="h-7 w-auto" /></Link>
        {!collapsed && <Button variant="ghost" size="icon-sm" aria-label={t.nav.collapseSidebar} onClick={() => setCollapsed(true)}><PanelLeftClose /></Button>}
      </div>
      {collapsed && <Button variant="ghost" className="mx-auto mb-3" size="icon-sm" aria-label={t.nav.expandSidebar} onClick={() => setCollapsed(false)}><PanelLeftOpen /></Button>}
      <div className="px-3"><Link href="/" className="flex h-10 items-center justify-center gap-2 rounded-xl bg-primary text-sm font-medium text-primary-foreground"><Plus className="size-4" />{!collapsed && t.nav.newTask}</Link></div>
      <nav aria-label={t.nav.primary} className="mt-6 flex flex-col gap-1 px-3">
        {navigation.map((item) => {
          const href = client.navigation.href(item.routeId)
          const active = href === '/' ? path === '/' : path === href || path.startsWith(`${href}/`)
          const Icon = item.icon
          return <Link key={item.id} href={href} title={text(item.label, language)} aria-current={active ? 'page' : undefined} className={`flex h-10 items-center gap-3 rounded-lg px-3 text-sm ${active ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/60'} ${collapsed ? 'justify-center' : ''}`}>{Icon && <Icon className="size-4 shrink-0" />}{!collapsed && text(item.label, language)}</Link>
        })}
      </nav>
      <div className="mt-auto space-y-2 p-3"><div className={`flex gap-1 border-t border-border pt-3 ${collapsed ? 'flex-col' : 'items-center'}`}><LanguageSwitcher /><ThemeToggle /><Button variant="ghost" size="icon-sm" aria-label={t.auth.logout} onClick={() => { void client.session.logout().catch((failure: Error) => setError(failure.message)) }}><LogOut /></Button></div></div>
    </aside>
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 lg:hidden">
      <Link href="/" className="font-semibold">YouDub</Link>
      <div className="flex items-center gap-1"><LanguageSwitcher /><ThemeToggle /><Button variant="ghost" size="icon-sm" aria-label={t.auth.logout} onClick={() => { void client.session.logout().catch((failure: Error) => setError(failure.message)) }}><LogOut /></Button></div>
      <nav className="flex w-full gap-4 overflow-x-auto whitespace-nowrap text-sm">{navigation.map((item) => <Link key={item.id} href={client.navigation.href(item.routeId)}>{text(item.label, language)}</Link>)}</nav>
    </header>
    {error && <div className="p-4"><InlineAlert>{error}</InlineAlert></div>}
    {content}
  </div>
}
function Root() { return <ThemeProvider><LanguageProvider><Shell /></LanguageProvider></ThemeProvider> }
export const name = 'client-shell'
export const inject = ['slots', 'session', 'navigation']
export function apply(ctx: Context) {
  restoreTheme()
  ctx.effect(() => ctx.slots.register('root', { id: 'youdub-shell', component: Root }))
}
