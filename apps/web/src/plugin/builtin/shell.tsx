import { Context } from 'cordis'
import { useState } from 'react'
import { LogOut, PanelLeftClose, PanelLeftOpen, Plus } from 'lucide-react'
import { Link, matchRoute, type RouteEntry, text, useClient, useObservable, usePathname, useSlot } from '../sdk'
import { restoreTheme, ThemeProvider } from '@/lib/theme'
import { LanguageProvider, useI18n } from '@/lib/i18n'
import { LanguageMenuButton, LanguageSwitcher } from '@/components/language-switcher'
import { ThemeToggle } from '@/components/theme-toggle'
import { Button } from '@/components/ui/button'
import { InlineAlert } from '@/components/inline-alert'
import { BrandMark } from '@/components/brand/brand-mark'
import { Tooltip } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

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
  const [collapsed, setCollapsed] = useState(() => window.localStorage.getItem('youdub-sidebar') === 'collapsed')
  const [error, setError] = useState('')
  function changeSidebar(next: boolean) {
    try {
      window.localStorage.setItem('youdub-sidebar', next ? 'collapsed' : 'expanded')
      setCollapsed(next)
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
  }
  if (session.status === 'error') return <main className="mx-auto max-w-xl p-8"><InlineAlert>{session.error}</InlineAlert></main>
  if (session.status === 'loading') return <div role="status" className="p-8 text-sm text-muted-foreground">{t.auth.sessionLoading}</div>
  const match = resolveRoute(routes, path, session.status === 'authenticated')
  const Page = match?.route.component
  const content = Page ? <Page key={`${match.route.id}:${path}`} params={match.params!} /> : <div className="p-8"><h1 className="text-xl font-semibold">404</h1><p className="mt-2 text-muted-foreground">{language === 'zh' ? '当前插件组合未提供这个页面。' : 'This page is not provided by the active plugins.'}</p></div>
  if (session.status === 'anonymous') return content
  return <div className={cn('min-h-screen transition-[padding] duration-200 ease-out', collapsed ? 'lg:pl-[72px]' : 'lg:pl-[248px]')}>
    <aside className={cn('fixed inset-y-0 left-0 z-40 hidden flex-col border-r border-border bg-surface transition-[width] duration-200 ease-out lg:flex', collapsed ? 'w-[72px]' : 'w-[248px]')}>
      <div className={cn('flex h-16 shrink-0 items-center gap-2', collapsed ? 'justify-center px-0' : 'justify-between pr-3 pl-5')}>
        <Link href="/" aria-label="YouDub" className="rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/40"><BrandMark animated wordmark={!collapsed} className={collapsed ? 'h-[22px]' : 'h-7'} /></Link>
        {!collapsed && <Tooltip content={t.nav.collapseSidebar}><Button variant="ghost" size="icon-sm" aria-label={t.nav.collapseSidebar} onClick={() => changeSidebar(true)}><PanelLeftClose /></Button></Tooltip>}
      </div>
      {collapsed && <div className="flex justify-center pb-3"><Tooltip content={t.nav.expandSidebar} side="right"><Button variant="ghost" size="icon-sm" aria-label={t.nav.expandSidebar} onClick={() => changeSidebar(false)}><PanelLeftOpen /></Button></Tooltip></div>}
      <div className={cn('px-3', collapsed && 'flex justify-center')}><Tooltip content={t.nav.newTask} side="right" className={collapsed ? undefined : 'hidden'}><Button nativeButton={false} render={<Link href="/" />} size="lg" className={collapsed ? 'size-10 px-0' : 'w-full'}><Plus /><span className={collapsed ? 'sr-only' : undefined}>{t.nav.newTask}</span></Button></Tooltip></div>
      <nav aria-label={t.nav.primary} className={cn('mt-6 flex flex-col px-3', collapsed ? 'items-center gap-1' : 'gap-0.5')}>
        {navigation.map((item) => {
          const href = client.navigation.href(item.routeId)
          const active = href === '/' ? path === '/' : path === href || path.startsWith(`${href}/`)
          const Icon = item.icon
          return <Tooltip key={item.id} content={text(item.label, language)} side="right" className={collapsed ? undefined : 'hidden'}><Link href={href} aria-current={active ? 'page' : undefined} className={cn('relative flex h-9 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/40', active ? 'bg-accent text-foreground before:absolute before:top-1/2 before:left-0 before:h-4 before:w-[3px] before:-translate-y-1/2 before:rounded-full before:bg-[linear-gradient(180deg,var(--brand-pink),var(--brand-blue))]' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground', collapsed && 'size-10 justify-center px-0')}>{Icon && <Icon className={cn('size-4 shrink-0', !active && 'text-subtle-foreground')} />}<span className={collapsed ? 'sr-only' : undefined}>{text(item.label, language)}</span></Link></Tooltip>
        })}
      </nav>
      <div className={cn('mt-auto flex flex-col gap-3 p-3', collapsed && 'items-center')}><div className={cn('flex items-center gap-1 border-t border-border pt-3', collapsed && 'w-full flex-col')}>{collapsed ? <LanguageMenuButton /> : <LanguageSwitcher className="mr-auto" />}<ThemeToggle /><Button variant="ghost" size="icon-sm" aria-label={t.auth.logout} onClick={() => { void client.session.logout().catch((failure: Error) => setError(failure.message)) }}><LogOut /></Button></div></div>
    </aside>
    <header className="glass sticky top-0 z-40 flex h-14 items-center justify-between gap-3 border-b border-border px-4 lg:hidden">
      <Link href="/" aria-label="YouDub" className="rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/40"><BrandMark animated wordmark className="h-6" /></Link>
      <div className="flex items-center gap-1"><LanguageSwitcher /><ThemeToggle /><Button variant="ghost" size="icon-sm" aria-label={t.auth.logout} onClick={() => { void client.session.logout().catch((failure: Error) => setError(failure.message)) }}><LogOut /></Button></div>
    </header>
    <div className="relative pb-24 lg:pb-0">{error && <div className="p-4"><InlineAlert>{error}</InlineAlert></div>}{content}</div>
    <nav aria-label={t.nav.primary} className="glass fixed inset-x-0 bottom-0 z-40 grid border-t border-border pb-[env(safe-area-inset-bottom)] lg:hidden" style={{ gridTemplateColumns: `repeat(${navigation.length}, minmax(0, 1fr))` }}>
      {navigation.map((item) => {
        const href = client.navigation.href(item.routeId)
        const active = href === '/' ? path === '/' : path === href || path.startsWith(`${href}/`)
        const Icon = item.icon
        return <Link key={item.id} href={href} aria-current={active ? 'page' : undefined} className={cn('relative flex flex-col items-center gap-1 pt-2.5 pb-2 text-[11px] font-medium outline-none', active ? 'text-foreground' : 'text-subtle-foreground')}>
          {active && <span aria-hidden="true" className="absolute top-0 h-0.5 w-8 rounded-full bg-brand-gradient" />}
          {Icon && <Icon className="size-5" />}{text(item.label, language)}
        </Link>
      })}
    </nav>
  </div>
}
function Root() { return <ThemeProvider><LanguageProvider><Shell /></LanguageProvider></ThemeProvider> }
export const name = 'client-shell'
export const inject = ['slots', 'session', 'navigation']
export function apply(ctx: Context) {
  restoreTheme()
  ctx.effect(() => ctx.slots.register('root', { id: 'youdub-shell', component: Root }))
}
