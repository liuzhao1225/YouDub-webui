import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { defineStore } from '@deepseek-ai/dsh-client-store'
import { Button, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { IconLayoutSidebar as PanelLeft, IconPlus as Plus, IconSparkles as Sparkles, IconHistory as History, IconGitBranch as Branch, IconFolder as Folder, IconPuzzle as Plugin } from '@tabler/icons-react'
import { IconBrandGithub, IconMessageReport, IconSettings } from '@tabler/icons-react'
import { SetupGate } from '@/components/setup-gate'
import { ThemeProvider, ThemeToggle, useTheme } from './frontend/theme'
import { feedbackIssue } from '../../web/src/lib/setup-diagnostics'
import { Button as YouDubButton } from '../../web/src/components/ui/button'
import { BrandMark } from '@/components/brand/brand-mark'
import { applyPlugins } from './frontend/plugins'
import { TranslationSetup, applyTranslationSetup } from './frontend/translation-setup'
import { CurrentVersionRow } from '../../../vendor/deepseek-harness/source/packages/client/ui-settings-general/src/client/CurrentVersionRow'
import logo from 'youdub:logo'
import { resolveRoute } from '../../web/src/plugin/domain-helpers'
import { StudioPage } from './frontend/studio-page'
import { TasksPage, TaskPage, NodePage } from './frontend/task-pages'
import { WorkflowsPage, WorkflowPage } from './frontend/workflow-pages'
import { ResourcesPage } from './frontend/resource-pages'
import { ExamplesPage } from './frontend/examples-page'
import { createFeatures, domainSlots, FeatureProvider, useFeatures } from './frontend/runtime'
import { LanguageProvider, useText, useI18n } from './frontend/i18n'
import { applyLocales } from './frontend/locales'
import { NavigationContext } from './frontend/sdk'
import { LocalizeEditor } from '../../web/src/plugin/builtin/localize-editor'
import { TaskWorkflowPanel, TranscriptNodeDetails, TranslationNodeDetails } from '../../web/src/plugin/builtin/workflow-task'
import { SynthesizeNodeEditor } from '../../web/src/plugin/builtin/workflow-settings'
import themeCss, { tokens } from 'youdub:theme'
import domainCss from 'youdub:styles'
import css from './style.css'
export const inject = ['slots','layout','theme','locale','remote','remote.pluginManager','remote.pluginInventory','remote.pluginRegistryProbe','configForms','settingsSchema','remote.credentials','remote.llm','remote.settings']
const routes = [
  { path:'/', key:'studio', component:StudioPage },
  { path:'/tasks', key:'tasks', component:TasksPage },
  { path:'/tasks/:id', key:'task', component:TaskPage },
  { path:'/tasks/:id/nodes/:nodeId', key:'task-node', component:NodePage },
  { path:'/workflows', key:'workflows', component:WorkflowsPage },
  { path:'/workflows/:id', key:'workflow', component:WorkflowPage },
  { path:'/workflows/:id/nodes/:nodeId', key:'workflow-node', component:WorkflowPage },
  { path:'/resources', key:'resources', component:ResourcesPage },
  { path:'/examples', key:'examples', component:ExamplesPage },
]
function IconButton({ label, children, ...props }) { return <Tooltip label={label} portal><Button aria-label={label} className="yd-icon-button" {...props}>{children}</Button></Tooltip> }
function IconLink({ label, href, children }) { return <Tooltip label={label} portal><a className="yd-icon-button yd-icon-link" aria-label={label} href={href} target="_blank" rel="noopener noreferrer">{children}</a></Tooltip> }
function SettingsLauncher({ openSettings, registerSettingsLauncher }) {
  const tx=useText()
  useEffect(() => registerSettingsLauncher(openSettings),[openSettings,registerSettingsLauncher])
  return <IconButton label={tx("client.settings")} onClick={() => openSettings()}><IconSettings size={16} aria-hidden="true" /></IconButton>
}
function SidebarView({ collapsed, useStore, navigate, toggleSidebar, renderSlot }) {
  const tx=useText(),{t,language}=useI18n(),{theme}=useTheme()
  const path = useStore(state => state.path)
  const issue = feedbackIssue({ ...globalThis.__YOUDUB_APP_INFO__, page:path, language, theme, userAgent:navigator.userAgent })
  const items = [{path:'/', label:tx("client.workbench"), icon:Sparkles}, {path:'/tasks',label:tx("client.library"),icon:History}, {path:'/workflows',label:tx("client.workflows"),icon:Branch}, {path:'/resources',label:tx("client.resources"),icon:Folder}, {path:'/extensions',label:tx("client.extensions"),icon:Plugin}]
  return <aside className="yd yd-sidebar" data-collapsed={collapsed || undefined}>
    <div className="yd-sidebar-chrome" data-window-drag aria-hidden="true" />
    <div className="yd-brand-row"><Button className="yd-brand" aria-label={tx('client.home')} onClick={() => navigate('/')}><BrandMark animated wordmarkSrc={logo} wordmark={!collapsed} className={collapsed ? 'h-6' : 'h-7'} /></Button>{!collapsed && <IconButton label={t.nav.collapseSidebar} onClick={toggleSidebar}><PanelLeft /></IconButton>}</div>
    {collapsed && <div className="yd-sidebar-expand"><IconButton label={t.nav.expandSidebar} onClick={toggleSidebar}><PanelLeft /></IconButton></div>}
    <YouDubButton size="lg" className={collapsed ? 'size-10 px-0' : 'w-full'} aria-label={t.nav.newTask} onClick={() => navigate('/')}><Plus />{!collapsed && t.nav.newTask}</YouDubButton>
    <nav aria-label={t.nav.primary}>{items.map(({path:target,label,icon:Icon}) => <Button key={target} aria-label={label} aria-current={(target === '/' ? path === '/' : path.startsWith(target)) ? 'page' : undefined} icon={<Icon />} onClick={() => navigate(target)}>{!collapsed && label}</Button>)}{renderSlot('youdub.navigation',{path,navigate,collapsed})}</nav>
    <div className="yd-sidebar-bottom"><div className="yd-settings-control">{renderSlot('sidebar.settings',{wide:false})}</div><ThemeToggle /><IconLink label={tx('client.feedback')} href={issue.url}><IconMessageReport size={16} aria-hidden="true" /></IconLink><IconLink label="GitHub" href="https://github.com/liuzhao1225/YouDub-webui"><IconBrandGithub size={16} aria-hidden="true" /></IconLink></div>
  </aside>
}
function Sidebar(props) { return <LanguageProvider source={props.localeSource}><ThemeProvider source={props.themeSource}><SidebarView {...props} /></ThemeProvider></LanguageProvider> }
function Leading({ toggleSidebar, localeSource }) { return <LanguageProvider source={localeSource}><LeadingView toggleSidebar={toggleSidebar} /></LanguageProvider> }
function LeadingView({ toggleSidebar }) { const {t}=useI18n(); return <div className="yd"><IconButton label={t.nav.expandSidebar} onClick={toggleSidebar}><PanelLeft /></IconButton></div> }
function Startup({ features, localeSource, themeSource, onReady, renderSlot, translationModels, pickDirectory }) {
  const [examples,setExamples]=useState(false)
  const bindings=useMemo(() => ({...features,navigate:() => setExamples(false)}),[features])
  return <LanguageProvider source={localeSource}><ThemeProvider source={themeSource}><FeatureProvider value={bindings}>
    <div className="yd yd-feature-root yd-startup"><div className="yd-main-chrome" data-window-drag aria-hidden="true" /><div className="yd-startup-content">
      {examples ? <ExamplesPage params={{}} /> : <SetupGate request={features.request} screenProps={{pickDirectory,wordmarkSrc:logo,themeControl:<ThemeToggle />,examplesHref:'/api/youdub/examples/index.html',onOpenExamples:() => setExamples(true),className:'min-h-full'}}><TranslationSetup request={features.request} onReady={onReady} wordmarkSrc={logo} renderSlot={renderSlot} translationModels={translationModels} /></SetupGate>}
    </div></div>
  </FeatureProvider></ThemeProvider></LanguageProvider>
}
function Main({ useStore, renderSlot, features, localeSource, themeSource, pageRegistry }) {
  const path = useStore(state => state.path), error = useStore(state => state.error), scroll = useRef(null)
  useSyncExternalStore(pageRegistry.subscribe,pageRegistry.getSnapshot)
  useEffect(() => { if (scroll.current) scroll.current.scrollTop = 0 },[path])
  const available = [...routes,...pageRegistry.entries().filter(entry => entry.options.key?.startsWith('/')).map(entry => ({path:entry.options.key,key:entry.options.key}))]
  const location = path.split('?')[0], match = resolveRoute(available,location,true), route=match?.route, params = match ? {...match.params,__search:path.includes('?') ? path.slice(path.indexOf('?')) : ''} : {}
  const bindings = useMemo(() => ({...features,renderSlot}),[features,renderSlot])
  return <LanguageProvider source={localeSource}><ThemeProvider source={themeSource}><NavigationContext.Provider value={features.navigate}><FeatureProvider value={bindings}>
    <div className="yd yd-panel"><div className="yd-main-chrome" data-window-drag aria-hidden="true" />
      <main className="yd-main yd-feature-root" ref={scroll} data-youdub-page={route?.key}>
        {error && <div role="alert" className="yd-domain-alert">{error}</div>}
        <React.Fragment key={path}>{route ? renderSlot('youdub.page',{params,...features},{entryKey:route.key}) : <div className="yd-feature-page"><MissingPage navigate={features.navigate} /></div>}</React.Fragment>
      </main>
    </div>
  </FeatureProvider></NavigationContext.Provider></ThemeProvider></LanguageProvider>
}
function MissingPage({navigate}) { const tx=useText();return <><h1>{tx('client.pageNotFound')}</h1><Button onClick={() => navigate('/')}>{tx('client.backToWorkbench')}</Button></> }
function BoundLocalize(props) { return <LocalizeEditor {...props} {...useFeatures()} /> }
function BoundSynthesize(props) { return <SynthesizeNodeEditor {...props} {...useFeatures()} /> }
function BoundWorkflowPanel(props) { return <TaskWorkflowPanel {...props} {...useFeatures()} /> }
export function apply(ctx) {
  applyPlugins(ctx)
  applyLocales(ctx)
  const translationModels=applyTranslationSetup(ctx)
  const blockers = new Set()
  let settingsLauncher
  const handle = defineStore({ init:() => ({path:'/',error:''}), actions:{ select(d,path){d.path=path;d.error=''}, fail(d,error){d.error=error} } })
  const instance = handle.create(), store = {...handle,create:() => instance}
  const blockNavigation = handler => { blockers.add(handler); return () => blockers.delete(handler) }
  const navigate = path => {
    void (async () => {
      for (const check of blockers) if (!await check(path)) return
      if (path.startsWith('/settings')) {
        if (path.startsWith('/settings/resources')) path = '/resources'
        else if (path.startsWith('/settings/extensions')) path = '/extensions'
        else {
          if (!settingsLauncher) throw new Error(ctx.locale.bind('youdub')('client.settingsNotReady'))
          const section=path.split(/[/?#]/)[2]
          settingsLauncher(section === 'models' || section === 'connections' ? 'models' : undefined)
          return
        }
      }
      instance.actions.select(path); ctx.layout.selectPanel(path === '/extensions' ? 'plugins' : 'youdub'); ctx.layout.beginNavigation()
    })().catch(error => instance.actions.fail(error.message))
  }
  const features = createFeatures(ctx,navigate,blockNavigation)
  const localeSource = { getSnapshot:() => ctx.locale.getLocale(), subscribe:listener => ctx.locale.subscribe(listener), setLanguage:value => ctx.locale.setLocale(value), text:ctx.locale.bind('youdub') }
  const themeSource = {getSnapshot:() => ctx.theme.getTheme(), subscribe:listener => ctx.on('theme/change',listener), setTheme:value => ctx.theme.setTheme(value)}
  const registerSettingsLauncher = launcher => { settingsLauncher=launcher; return () => { if(settingsLauncher===launcher) settingsLauncher=undefined } }
  const pageRegistry = { subscribe:listener => ctx.slots.subscribe('youdub.page',listener), getSnapshot:() => ctx.slots.getVersion('youdub.page'), entries:() => ctx.slots.entriesOfSlot('youdub.page') }
  const injected = () => ({features,navigate,localeSource,themeSource,pageRegistry,toggleSidebar:() => ctx.layout.toggleSidebar()})
  if (!globalThis.__YOUDUB_TEST_SKIP_SETUP__) ctx.effect(() => {
    const dispose=ctx.slots.register({name:'root',priority:-10,children:{'youdub.setup.models':{kind:'single',scope:'root'}},inject:() => ({features,localeSource,themeSource,translationModels,pickDirectory:globalThis.__DSH_DIRECTORY_PICKER__?.pick,onReady:() => dispose()})},Startup)
    return dispose
  })
  ctx.effect(() => { const previous=document.title;document.title='YouDub';return () => {document.title=previous} })
  ctx.effect(() => ctx.theme.overrideTokens('@youdub/harness-subtitles',tokens))
  ctx.effect(() => { const style=document.createElement('style');style.dataset.pluginCss='@youdub/harness-subtitles';style.textContent=themeCss+domainCss+css;document.head.append(style);return () => style.remove() })
  ctx.slots.inject('sidebar',() => ctx.slots.register({name:'sidebar',store,inject:injected,children:{'sidebar.settings':{kind:'single',scope:'root'},'youdub.navigation':{kind:'list',scope:'root'}}},Sidebar))
  ctx.slots.inject('shell.leading',() => ctx.slots.register({name:'shell.leading',inject:injected},Leading))
  ctx.slots.inject('settings.general.item',() => ctx.slots.register({name:'settings.general.item',id:'current-version',priority:-10,order:100,locale:'settings'},CurrentVersionRow))
  for(const id of ['developer-tools','font-size']) ctx.slots.inject('settings.general.item',() => ctx.slots.register({name:'settings.general.item',id,priority:-10},() => null))
  ctx.slots.inject('settings.launcher',() => ctx.slots.register({name:'settings.launcher',inject:() => ({registerSettingsLauncher})},SettingsLauncher))
  const children = {'youdub.page':{kind:'keyed',scope:'root'},...Object.fromEntries(domainSlots.map(slot => [`youdub.${slot}`,{kind:'list',scope:'root'}]))}
  ctx.slots.inject('main',() => {
    const dispose=ctx.slots.register({name:'main',key:'youdub',store,inject:injected,children},Main)
    ctx.layout.selectPanel('youdub');return dispose
  })
  for (const route of routes) ctx.slots.inject('youdub.page',() => ctx.slots.register({name:'youdub.page',key:route.key},route.component))
  const entries=[['config.editors','youdub.localize',BoundLocalize],['workflow.node.editors','youdub.synthesize',BoundSynthesize],['workflow.node.details','youdub.transcript',TranscriptNodeDetails],['workflow.node.details','youdub.translation',TranslationNodeDetails],['task.detail.panels','workflow-graph',BoundWorkflowPanel]]
  for(const [slot,id,component] of entries) ctx.slots.inject(`youdub.${slot}`,() => ctx.slots.register({name:`youdub.${slot}`,id},component))
}
