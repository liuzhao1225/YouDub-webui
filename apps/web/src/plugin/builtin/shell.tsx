import { Context } from 'cordis'
import { useState } from 'react'
import { PanelLeftClose, PanelLeftOpen, Plus } from 'lucide-react'
import { Link, matchRoute, type RouteEntry, text, bindComponent, type Bindings } from '../sdk'
import { restoreTheme, ThemeProvider } from '@/lib/theme'
import { LanguageProvider, useI18n, useText } from '@/lib/i18n'
import { LanguageMenuButton, LanguageSwitcher } from '@/components/language-switcher'
import { ThemeToggle } from '@/components/theme-toggle'
import { Button } from '@/components/ui/button'
import { InlineAlert } from '@/components/inline-alert'
import { BrandMark } from '@/components/brand/brand-mark'
import { Tooltip } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { UpdateNotice, UpdateProvider } from '@/components/app-updates'
import { Page as PageLayout, PageHeader } from '@/components/page-layout'
import { SidebarLink } from '@/components/sidebar-link'

export function resolveRoute(routes: RouteEntry[], path: string, authenticated: boolean) {
  // Static segments take precedence over parameters, independently of plugin
  // installation order (for example /tasks/help before /tasks/:id).
  const specificity = (pattern: string) => pattern.split('/').map((part) => part.startsWith(':') ? '0' : '1').join('')
  return routes.map((route) => ({ route, params: matchRoute(path, route.path) }))
    .filter((item) => item.params && (item.route.access === 'public' || authenticated))
    .sort((a, b) => specificity(b.route.path).localeCompare(specificity(a.route.path)))[0]
}
function Shell({ request, navigate, href: routeHref, useSession, useSlot, usePathname, useUpdates }: Bindings<'request' | 'navigate' | 'href' | 'useSession' | 'useSlot' | 'usePathname' | 'useUpdates'>) {
  const tx = useText()
  const session = useSession()
  const path = usePathname()
  const routes = useSlot('shell.routes')
  const navigation = useSlot('shell.navigation')
  const primaryNavigation = navigation.filter(item => item.placement !== 'footer')
  const footerNavigation = navigation.filter(item => item.placement === 'footer')
  const { language, t } = useI18n()
  const [collapsed, setCollapsed] = useState(() => window.localStorage.getItem('youdub-sidebar') === 'collapsed')
  const [error, setError] = useState('')
  function changeSidebar(next: boolean) {
    try {
      window.localStorage.setItem('youdub-sidebar', next ? 'collapsed' : 'expanded')
      setCollapsed(next)
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
  }
  if (session.status === 'error') return <PageLayout className="max-w-xl"><InlineAlert>{session.error}</InlineAlert></PageLayout>
  if (session.status === 'loading') return <PageLayout className="max-w-xl"><p role="status" className="text-sm text-muted-foreground">{t.auth.sessionLoading}</p></PageLayout>
  const match = resolveRoute(routes, path, session.status === 'authenticated')
  const dialog = match?.route.layout === 'dialog' ? match : undefined
  const returnTo = window.history.state?.youdubReturnTo
  const candidate = typeof returnTo === 'string' && returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo.split('?')[0] : '/'
  const background = dialog ? resolveRoute(routes, candidate, true) : undefined
  const pagePath = dialog ? background?.route.layout === 'dialog' ? '/' : candidate : path
  const pageMatch = dialog ? resolveRoute(routes, pagePath, true) : match
  const Page = pageMatch?.route.component, DialogPage = dialog?.route.component
  const content = Page ? <Page key={`${pageMatch.route.id}:${pagePath}`} params={pageMatch.params!} returnTo={returnTo} /> : <PageLayout><PageHeader title="404"><p className="mt-2 text-muted-foreground">{language === 'zh' ? '当前插件组合未提供这个页面。' : 'This page is not provided by the active plugins.'}</p></PageHeader></PageLayout>
  const footerButtons = footerNavigation.map(item => {
    const label = text(item.label, language), Icon = item.icon
    const isDialog = routes.find(route => route.id === item.routeId)?.layout === 'dialog'
    return <Tooltip key={item.id} content={label}><Button variant="ghost" size={Icon ? 'icon' : 'sm'} aria-label={label} aria-haspopup={isDialog ? 'dialog' : undefined} aria-expanded={isDialog ? !!dialog : undefined} onClick={() => navigate(routeHref(item.routeId))}>{Icon ? <Icon /> : label}</Button></Tooltip>
  })
  if (session.status === 'anonymous') return content
  if (match?.route.layout === 'standalone') return <UpdateProvider request={request}>{content}</UpdateProvider>
  return <UpdateProvider request={request}><div className={cn('min-h-screen transition-[padding] duration-200 ease-out', collapsed ? 'lg:pl-[72px]' : 'lg:pl-[248px]')}>
    <aside className={cn('fixed inset-y-0 left-0 z-40 hidden flex-col border-r border-border bg-surface transition-[width] duration-200 ease-out lg:flex', collapsed ? 'w-[72px]' : 'w-[248px]')}>
      <div className={cn('flex h-16 shrink-0 items-center gap-2', collapsed ? 'justify-center px-0' : 'justify-between pr-3 pl-5')}>
        <Link href="/" aria-label="YouDub" className="rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/40"><BrandMark animated wordmark={!collapsed} className={collapsed ? 'h-[22px]' : 'h-7'} /></Link>
        {!collapsed && <Tooltip content={t.nav.collapseSidebar}><Button variant="ghost" size="icon-sm" aria-label={t.nav.collapseSidebar} onClick={() => changeSidebar(true)}><PanelLeftClose /></Button></Tooltip>}
      </div>
      {collapsed && <div className="flex justify-center pb-3"><Tooltip content={t.nav.expandSidebar} side="right"><Button variant="ghost" size="icon-sm" aria-label={t.nav.expandSidebar} onClick={() => changeSidebar(false)}><PanelLeftOpen /></Button></Tooltip></div>}
      <div className={cn('px-3', collapsed && 'flex justify-center')}><Tooltip content={t.nav.newTask} side="right" className={collapsed ? undefined : 'hidden'}><Button nativeButton={false} render={<Link href="/" />} size="lg" className={collapsed ? 'size-10 px-0' : 'w-full'}><Plus /><span className={collapsed ? 'sr-only' : undefined}>{t.nav.newTask}</span></Button></Tooltip></div>
      <nav aria-label={t.nav.primary} className={cn('mt-6 flex flex-col px-3', collapsed ? 'items-center gap-1' : 'gap-0.5')}>
        {primaryNavigation.map((item) => {
          const href = routeHref(item.routeId)
          const active = href === '/' ? pagePath === '/' : pagePath === href || pagePath.startsWith(`${href}/`)
          return <SidebarLink key={item.id} href={href} label={text(item.label, language)} icon={item.icon} active={active} collapsed={collapsed} />
        })}
      </nav>
      <div className={cn('mt-auto p-3', collapsed && 'flex justify-center')}>
        <div aria-label={tx('App controls', '应用设置', 'アプリ設定')} className={cn('flex items-center gap-1 border-t border-border pt-3', collapsed && 'w-full flex-col')}>{collapsed ? <LanguageMenuButton /> : <LanguageSwitcher className="mr-auto" />}<ThemeToggle />{footerButtons}</div>
      </div>
    </aside>
    <header className="glass sticky top-0 z-40 flex h-14 items-center justify-between gap-3 border-b border-border px-4 lg:hidden">
      <Link href="/" aria-label="YouDub" className="rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/40"><BrandMark animated wordmark className="h-6" /></Link>
      <div className="flex items-center gap-1"><LanguageMenuButton /><ThemeToggle />{footerButtons}</div>
    </header>
    <div className="relative pb-24 lg:pb-0"><UpdateNotice useUpdates={useUpdates} hidden={!!dialog} />{error && <div className="p-4"><InlineAlert>{error}</InlineAlert></div>}{content}</div>
    <nav aria-label={t.nav.primary} className="glass fixed inset-x-0 bottom-0 z-40 grid border-t border-border pb-[env(safe-area-inset-bottom)] lg:hidden" style={{ gridTemplateColumns: `repeat(${primaryNavigation.length}, minmax(0, 1fr))` }}>
      {primaryNavigation.map((item) => {
        const href = routeHref(item.routeId)
        const active = href === '/' ? pagePath === '/' : pagePath === href || pagePath.startsWith(`${href}/`)
        const Icon = item.icon
        return <Link key={item.id} href={href} aria-current={active ? 'page' : undefined} className={cn('relative flex flex-col items-center gap-1 pt-2.5 pb-2 text-[11px] font-medium outline-none', active ? 'text-foreground' : 'text-subtle-foreground')}>
          {active && <span aria-hidden="true" className="absolute top-0 h-0.5 w-8 rounded-full bg-brand-gradient" />}
          {Icon && <Icon className="size-5" />}{text(item.label, language)}
        </Link>
      })}
    </nav>
    {DialogPage && <DialogPage key="route-dialog" params={dialog.params!} returnTo={returnTo} />}
  </div></UpdateProvider>
}
function Root(props: Bindings<'request' | 'navigate' | 'href' | 'useSession' | 'useSlot' | 'usePathname' | 'useUpdates'>) { return <ThemeProvider><LanguageProvider><Shell {...props} /></LanguageProvider></ThemeProvider> }
export const name = 'client-shell'
export const inject = ['slots', 'session', 'navigation', 'apiClient']
export function apply(ctx: Context) {
  restoreTheme()
  ctx.effect(() => ctx.slots.register('root', { id: 'youdub-shell', component: bindComponent(ctx, ['request', 'navigate', 'href', 'useSession', 'useSlot', 'usePathname', 'useUpdates'], Root) }))
}
