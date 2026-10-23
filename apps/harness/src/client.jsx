import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createSnapshotStore, defineStore } from '@deepseek-ai/dsh-client-store'
import { Button, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { IconSparkles as Sparkles, IconHistory as History, IconGitBranch as Branch, IconFolder as Folder, IconPuzzle as Plugin } from '@tabler/icons-react'
import { IconBrandGithub, IconMessageReport, IconSettings } from '@tabler/icons-react'
import { SetupGate } from '@/components/setup-gate'
import { ThemeProvider, ThemeToggle, useTheme } from './frontend/theme'
import { feedbackIssue } from '../../web/src/lib/setup-diagnostics'
import { BrandMark } from '@/components/brand/brand-mark'
import { Page, PageHeader, WindowHeaderProvider } from '@/components/page-layout'
import { applyPlugins } from './frontend/plugins'
import { TranslationSetup, applyTranslationSetup } from './frontend/translation-setup'
import { CurrentVersionRow } from '../../../vendor/deepseek-harness/source/packages/client/ui-settings-general/src/client/CurrentVersionRow'
import { SidebarRoot } from '../../../vendor/deepseek-harness/source/packages/client/ui-sidebar/src/client/SidebarRoot'
import { HeaderLeadingControls } from '../../../vendor/deepseek-harness/source/packages/client/ui-sidebar/src/client/HeaderLeadingControls'
import buttonCss from '../../../vendor/deepseek-harness/source/packages/client/ui-primitives/src/Button.module.css'
import shellCss from '../../../vendor/deepseek-harness/source/packages/client/ui-conversation/src/client/skeleton/ConversationRoot.module.css'
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
import themeCss from 'youdub:theme'
import domainCss from 'youdub:styles'
import css from './style.css'
export const inject = ['slots','layout','theme','locale','remote','remote.pluginManager','remote.pluginInventory','remote.pluginRegistryProbe','configForms','settingsSchema','remote.credentials','remote.llm','remote.settings','shortcuts']
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
function IconLink({ label, href, children }) { return <Tooltip label={label} portal><a className={`${buttonCss.button} ${buttonCss.md} ${buttonCss.ghost} yd-icon-button yd-icon-link`} aria-label={label} href={href} target="_blank" rel="noopener noreferrer">{children}</a></Tooltip> }
function SettingsLauncher({ openSettings, registerSettingsLauncher }) {
  const tx=useText()
  useEffect(() => registerSettingsLauncher(openSettings),[openSettings,registerSettingsLauncher])
  return <IconButton label={tx("client.settings")} onClick={() => openSettings()}><IconSettings size={16} aria-hidden="true" /></IconButton>
}
// Harness owns all sidebar geometry and controls; this adapter supplies product routes.
function SidebarView(props) {
  const {t}=useI18n()
  const translate=key => ({'session.new':t.nav.newTask,'session.new.label':t.nav.newTask,'toggle.open':t.nav.expandSidebar,'toggle.collapse':t.nav.collapseSidebar,'panels.label':t.nav.primary})[key]
  const renderSlot=(name,owner,options) => {
    if(name==='sidebar.brand.mark') return props.renderSlot(name,{...owner,wide:!props.collapsed},options)
    if(name==='sidebar.settings') return <SidebarTools {...props} wide={owner.wide} settings={props.renderSlot(name,{wide:false},options)} />
    return props.renderSlot(name,owner,options)
  }
  return <SidebarRoot {...props} renderSlot={renderSlot} t={translate} selectPanel={id => props.navigate(id==='plugins'?'/extensions':id)} startSession={() => props.navigate('/')} />
}
function Sidebar(props) { return <LanguageProvider source={props.localeSource}><SidebarView {...props} /></LanguageProvider> }
function LeadingView(props) {
  const {t}=useI18n()
  return <HeaderLeadingControls {...props} t={key => key==='toggle.open'?t.nav.expandSidebar:t.nav.newTask} startSession={() => props.navigate('/')} />
}
function Leading(props) { return <LanguageProvider source={props.localeSource}><LeadingView {...props} /></LanguageProvider> }
function SidebarBrand({wide}) { return <span className="yd yd-sidebar-mark" data-wide={wide}><BrandMark animated wordmark={wide} wordmarkSrc={logo} className={wide ? "h-8 w-auto" : "w-full h-auto"} /></span> }
function SidebarName() { return null }
function SidebarExtensions({wide,useStore,navigate,renderSlot}) { const path=useStore(state => state.path);return <div className="yd yd-extension-navigation">{renderSlot('youdub.navigation',{path,navigate,collapsed:!wide})}</div> }
function SidebarToolsView({wide,useStore,settings}) {
  const tx=useText(),{language}=useI18n(),{theme}=useTheme(),path=useStore(state => state.path)
  const issue=feedbackIssue({...globalThis.__YOUDUB_APP_INFO__,page:path,language,theme,userAgent:navigator.userAgent})
  return <div className="yd yd-sidebar-tools" data-wide={wide}>{settings}<ThemeToggle /><IconLink label={tx('client.feedback')} href={issue.url}><IconMessageReport size={16} aria-hidden="true" /></IconLink><IconLink label="GitHub" href="https://github.com/liuzhao1225/YouDub-webui"><IconBrandGithub size={16} aria-hidden="true" /></IconLink></div>
}
function SidebarTools(props) { return <LanguageProvider source={props.localeSource}><ThemeProvider source={props.themeSource}><SidebarToolsView {...props} /></ThemeProvider></LanguageProvider> }
function Startup({ features, localeSource, themeSource, onReady, renderSlot, translationModels, pickDirectory }) {
  const [examples,setExamples]=useState(false)
  const bindings=useMemo(() => ({...features,navigate:() => setExamples(false)}),[features])
  return <LanguageProvider source={localeSource}><ThemeProvider source={themeSource}><FeatureProvider value={bindings}>
    <div className="yd yd-feature-root yd-startup"><div className="yd-main-chrome" data-window-drag aria-hidden="true" /><div className="yd-startup-content">
      {examples ? <ExamplesPage params={{}} fromSetup /> : <SetupGate request={features.request} screenProps={{pickDirectory,wordmarkSrc:logo,themeControl:<ThemeToggle />,examplesHref:'/api/youdub/examples/index.html',onOpenExamples:() => setExamples(true),className:'min-h-full'}}><TranslationSetup request={features.request} onReady={onReady} wordmarkSrc={logo} renderSlot={renderSlot} translationModels={translationModels} /></SetupGate>}
    </div></div>
  </FeatureProvider></ThemeProvider></LanguageProvider>
}
function Main({ useStore, renderSlot, features, localeSource, themeSource, pageRegistry }) {
  const path = useStore(state => state.path), error = useStore(state => state.error), scroll = useRef(null)
  const [headerHost, setHeaderHost] = useState(null)
  useSyncExternalStore(pageRegistry.subscribe,pageRegistry.getSnapshot)
  useEffect(() => { if (scroll.current) scroll.current.scrollTop = 0 },[path])
  const available = [...routes,...pageRegistry.entries().filter(entry => entry.options.key?.startsWith('/')).map(entry => ({path:entry.options.key,key:entry.options.key}))]
  const location = path.split('?')[0], match = resolveRoute(available,location,true), route=match?.route, params = match ? {...match.params,__search:path.includes('?') ? path.slice(path.indexOf('?')) : ''} : {}
  const bindings = useMemo(() => ({...features,renderSlot}),[features,renderSlot])
  return <LanguageProvider source={localeSource}><ThemeProvider source={themeSource}><NavigationContext.Provider value={features.navigate}><FeatureProvider value={bindings}>
    <div className={`yd ${shellCss.root}`}><header className={shellCss.header} data-window-drag><div className={shellCss.titleRow} ref={setHeaderHost} /></header>
      <WindowHeaderProvider value={headerHost}>
      <main className="yd-main yd-feature-root" ref={scroll} data-youdub-page={route?.key}>
        {error && <div role="alert" className="yd-domain-alert">{error}</div>}
        <React.Fragment key={path}>{route ? renderSlot('youdub.page',{params,...features},{entryKey:route.key}) : <Page><MissingPage navigate={features.navigate} /></Page>}</React.Fragment>
      </main>
      </WindowHeaderProvider>
    </div>
  </FeatureProvider></NavigationContext.Provider></ThemeProvider></LanguageProvider>
}
function MissingPage({navigate}) { const tx=useText();return <><PageHeader title={tx('client.pageNotFound')} /><Button onClick={() => navigate('/')}>{tx('client.backToWorkbench')}</Button></> }
function BoundLocalize(props) { return <LocalizeEditor {...props} {...useFeatures()} /> }
function BoundSynthesize(props) { return <SynthesizeNodeEditor {...props} {...useFeatures()} /> }
function BoundWorkflowPanel(props) { return <TaskWorkflowPanel {...props} {...useFeatures()} /> }
export function apply(ctx) {
  applyPlugins(ctx)
  applyLocales(ctx)
  const translationModels=applyTranslationSetup(ctx)
  const panelRoutes=['/','/tasks','/workflows','/resources']
  const panels=createSnapshotStore([])
  const syncPanels=() => {
    const tx=ctx.locale.bind('youdub')
    panels.set([['/','client.workbench'],['/tasks','client.library'],['/workflows','client.workflows'],['/resources','client.resources'],['plugins','client.extensions']].map(([id,key],order) => ({id,order,label:tx(key)})))
  }
  ctx.effect(() => ctx.locale.subscribe(syncPanels))
  syncPanels()
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
      instance.actions.select(path); ctx.layout.selectPanel(path === '/extensions' ? 'plugins' : panelRoutes.find(id => id!=='/' && (path===id || path.startsWith(id+'/'))) ?? '/'); ctx.layout.beginNavigation()
    })().catch(error => instance.actions.fail(error.message))
  }
  const features = createFeatures(ctx,navigate,blockNavigation)
  const localeSource = { getSnapshot:() => ctx.locale.getLocale(), subscribe:listener => ctx.locale.subscribe(listener), setLanguage:value => ctx.locale.setLocale(value), text:ctx.locale.bind('youdub') }
  const themeSource = {getSnapshot:() => ctx.theme.getTheme(), subscribe:listener => ctx.on('theme/change',listener), setTheme:value => ctx.theme.setTheme(value)}
  const registerSettingsLauncher = launcher => { settingsLauncher=launcher; return () => { if(settingsLauncher===launcher) settingsLauncher=undefined } }
  const pageRegistry = { subscribe:listener => ctx.slots.subscribe('youdub.page',listener), getSnapshot:() => ctx.slots.getVersion('youdub.page'), entries:() => ctx.slots.entriesOfSlot('youdub.page') }
  const injected = () => ({features,navigate,localeSource,themeSource,pageRegistry,toggleSidebar:() => ctx.layout.toggleSidebar(),hooks:{panels,shortcuts:ctx.shortcuts.catalog}})
  if (!globalThis.__YOUDUB_TEST_SKIP_SETUP__) ctx.effect(() => {
    const dispose=ctx.slots.register({name:'root',priority:-10,children:{'youdub.setup.models':{kind:'single',scope:'root'}},inject:() => ({features,localeSource,themeSource,translationModels,pickDirectory:globalThis.__DSH_DIRECTORY_PICKER__?.pick,onReady:() => dispose()})},Startup)
    return dispose
  })
  ctx.effect(() => { const previous=document.title;document.title='YouDub';return () => {document.title=previous} })
  ctx.effect(() => { const style=document.createElement('style');style.dataset.pluginCss='@youdub/harness-subtitles';style.textContent=themeCss+domainCss+css;document.head.append(style);return () => style.remove() })
  ctx.slots.inject('sidebar',() => ctx.slots.register({name:'sidebar',store,inject:injected,children:{'sidebar.brand.mark':{kind:'single',scope:'root'},'sidebar.brand.name':{kind:'single',scope:'root'},'sidebar.toggle.badge':{kind:'single',scope:'root'},'sidebar.panellist':{kind:'list',scope:'root'},'sidebar.workspaces':{kind:'single',scope:'root'},'sidebar.settings':{kind:'single',scope:'root'},'sidebar.footer.action':{kind:'list',scope:'root'}}},Sidebar))
  ctx.slots.inject('shell.leading',() => ctx.slots.register({name:'shell.leading',inject:injected},Leading))
  ctx.slots.inject('sidebar.brand.mark',() => ctx.slots.register({name:'sidebar.brand.mark'},SidebarBrand))
  ctx.slots.inject('sidebar.brand.name',() => ctx.slots.register({name:'sidebar.brand.name'},SidebarName))
  for(const [id,Icon] of [['/',Sparkles],['/tasks',History],['/workflows',Branch],['/resources',Folder],['plugins',Plugin]]) ctx.slots.inject('sidebar.panellist',() => ctx.slots.register({name:'sidebar.panellist',id},({size}) => <Icon size={size} />))
  ctx.slots.inject('sidebar.workspaces',() => ctx.slots.register({name:'sidebar.workspaces',store,inject:injected,children:{'youdub.navigation':{kind:'list',scope:'root'}}},SidebarExtensions))
  ctx.slots.inject('settings.general.item',() => ctx.slots.register({name:'settings.general.item',id:'current-version',priority:-10,order:100,locale:'settings'},CurrentVersionRow))
  for(const id of ['developer-tools','font-size']) ctx.slots.inject('settings.general.item',() => ctx.slots.register({name:'settings.general.item',id,priority:-10},() => null))
  ctx.slots.inject('settings.launcher',() => ctx.slots.register({name:'settings.launcher',inject:() => ({registerSettingsLauncher})},SettingsLauncher))
  const children = {'youdub.page':{kind:'keyed',scope:'root'},...Object.fromEntries(domainSlots.map(slot => [`youdub.${slot}`,{kind:'list',scope:'root'}]))}
  ctx.effect(() => ctx.slots.registerFactory({name:'youdub.main',scope:'root',store,inject:injected,children},Main))
  for(const key of panelRoutes) ctx.slots.inject('main',() => ctx.slots.register({name:'main',key},({renderFactorySlot}) => renderFactorySlot('youdub.main',{})))
  ctx.layout.selectPanel('/')
  for (const route of routes) ctx.slots.inject('youdub.page',() => ctx.slots.register({name:'youdub.page',key:route.key},route.component))
  const entries=[['config.editors','youdub.localize',BoundLocalize],['workflow.node.editors','youdub.synthesize',BoundSynthesize],['workflow.node.details','youdub.transcript',TranscriptNodeDetails],['workflow.node.details','youdub.translation',TranslationNodeDetails],['task.detail.panels','workflow-graph',BoundWorkflowPanel]]
  for(const [slot,id,component] of entries) ctx.slots.inject(`youdub.${slot}`,() => ctx.slots.register({name:`youdub.${slot}`,id},component))
}
