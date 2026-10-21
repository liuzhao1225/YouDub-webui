/** YouDub composes the unchanged Harness plugin manager and its product-specific catalog. */
import React from 'react'
import { StateDot, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import { PluginManagerPage } from '../../../../vendor/deepseek-harness/source/packages/client/ui-plugin-manager/src/client/PluginManagerPage'
import { PluginManagerController } from '../../../../vendor/deepseek-harness/source/packages/client/ui-plugin-manager/src/client/manager-store'
import { configLedgerSource } from '../../../../vendor/deepseek-harness/source/packages/client/ui-plugin-manager/src/client/config-ledger'
import { tabLedgerSource } from '../../../../vendor/deepseek-harness/source/packages/client/ui-plugin-manager/src/client/tab-ledger'
import { createNavigationStore } from '../../../../vendor/deepseek-harness/source/packages/client/ui-plugin-manager/src/client/navigation-store'
import { PluginRefreshToast } from '../../../../vendor/deepseek-harness/source/packages/client/ui-plugin-manager/src/client/PluginRefreshToast'
import { rowText } from '../../../../vendor/deepseek-harness/source/packages/client/ui-plugin-manager/src/client/presentation'
import { en, zh } from '../../../../vendor/deepseek-harness/source/packages/client/ui-plugin-manager/src/client/locales'

/** Preserve stable source snapshots while selecting this product's installed bundles. */
function project(source:any, select:(snapshot:any)=>any) {
  let previous:any, selected:any
  return {subscribe:source.subscribe,getSnapshot:() => {const current=source.getSnapshot();if(current!==previous){previous=current;selected=select(current)}return selected}}
}
function BuiltinYouDub({view,usePluginManager,t,resolveText}:any) {
  const state=usePluginManager((snapshot:any) => snapshot),bundle=state.packages.find((item:any) => item.name==='@youdub/harness-subtitles')
  if(!bundle) return <span role="status">{state.status==='idle'||state.status==='loading'?t('loading'):state.status==='unavailable'?t('unavailable'):t('youdub.bundleMissing')}</span>
  const rows=bundle.rows.filter((row:any) => row.moduleName.startsWith('@youdub/'))
  if(view==='summary')return <>YouDub {process.env.DSH_CLIENT_VERSION} · {t('partsCountTotal',{count:String(rows.length)})}</>
  return <div className="space-y-5 text-sm">
    <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3"><dt>{t('youdub.applicationVersion')}</dt><dd>{process.env.DSH_CLIENT_VERSION}</dd><dt>{t('youdub.packageVersion')}</dt><dd>{bundle.version??'—'}</dd><dt>{t('sourceTitle')}</dt><dd>{t('youdub.bundled')}</dd></dl>
    {bundle.error&&<p role="alert" className="text-status-danger-fg">{bundle.error.diagnostic??bundle.error.code}</p>}
    <div className="divide-y divide-border">{rows.map((row:any) => <div key={row.rowId} className="flex items-center gap-3 py-3"><StateDot state={row.phase==='active'?'done':row.phase==='failed'?'error':row.enabled?'ongoing':'idle'} /><div className="min-w-0 flex-1"><div>{rowText(row,resolveText).title}</div><div className="text-xs text-muted-foreground">{row.rowId}</div></div><Tag tone={row.phase==='active'?'success':row.phase==='failed'?'danger':'neutral'}>{t(row.phase==='active'?'rowPhaseActive':row.phase==='failed'?'rowPhaseFailed':row.enabled?'rowPhaseLoading':'partOff')}</Tag></div>)}</div>
  </div>
}
export function applyPlugins(ctx:any) {
  const namespace='pluginManager'
  const brand=(dictionary:Record<string,string>) => Object.fromEntries(Object.entries(dictionary).map(([key,value]) => [key,value.replaceAll('DeepSeek Harness','YouDub').replaceAll('DSH','YouDub')]))
  const dictionaries={
    zh:{...brand(zh),'youdub.bundleMissing':'未读取到 YouDub 内置插件信息。','youdub.applicationVersion':'应用版本','youdub.packageVersion':'插件包版本','youdub.bundled':'随 YouDub 提供',title:'YouDub 插件',intro:'',infoDescription:'安装和管理 YouDub 插件。',installSpecPlaceholder:'插件包名、Git 仓库地址或本地目录',installGuideIdHint:'填写插件作者提供的 npm 包名。',installGuideIdExample:'@作者/插件名',installUpgradeNotice:'更新插件前，请先卸载再安装新版。'},
    en:{...brand(en),'youdub.bundleMissing':'The Host did not report the built-in YouDub bundle.','youdub.applicationVersion':'Application version','youdub.packageVersion':'Bundle version','youdub.bundled':'Included with YouDub',title:'YouDub plugins',intro:'',infoDescription:'Install and manage YouDub plugins.',installSpecPlaceholder:'Package name, Git repository, or local directory',installGuideIdHint:'Use the npm package name supplied by the plugin author.',installGuideIdExample:'@author/plugin',installUpgradeNotice:'To update a plugin, uninstall it and install the newer version.'},
  }
  ctx.effect(() => ctx.locale.register(namespace,dictionaries))
  const controller=new PluginManagerController(ctx)
  ctx.effect(() => () => controller.dispose())
  const face=controller.inject(configLedgerSource(ctx),tabLedgerSource(ctx),text => ctx.locale.resolveText(text))
  const productFace={...face,hooks:{...face.hooks,pluginManager:project(face.hooks.pluginManager,snapshot => ({...snapshot,packages:snapshot.packages.filter((pkg:any) => pkg.name!=='@youdub/harness-subtitles' && (!pkg.official || pkg.name.startsWith('@youdub/')))})),configLedger:project(face.hooks.configLedger,ledger => ({...ledger,items:ledger.items.filter((item:any) => item.id.startsWith('youdub.'))}))}}
  ctx.effect(() => {
    const refresh=() => {if(controller.getSnapshot().status!=='idle')void controller.load()}
    const off=[ctx.remote.$on('plugin-manager/changed',refresh),ctx.remote.$on('plugin-manager/install-log',(chunk:any) => controller.appendLog(chunk)),ctx.remote.$on('plugin-manager/install-state',(progress:any) => controller.installProgress(progress)),ctx.on('connection/reset',refresh)]
    return () => off.forEach(dispose => dispose())
  })
  ctx.slots.inject('plugins.item',() => ctx.slots.register({name:'plugins.item',id:'youdub.builtin',label:() => ctx.locale.getLocale().active.startsWith('zh')?'YouDub 内置功能':'YouDub built-in features',locale:namespace,inject:() => ({hooks:{pluginManager:face.hooks.pluginManager},resolveText:face.resolveText})},BuiltinYouDub))
  ctx.slots.inject('shell.overlay',() => ctx.slots.register({name:'shell.overlay',id:'youdub.plugins.refresh',locale:namespace,inject:() => ({hooks:{pluginManager:productFace.hooks.pluginManager},dismissNotice:face.dismissNotice})},PluginRefreshToast))
  ctx.slots.inject('main',function*(){
    const handle=createNavigationStore(),instance=handle.create(),store={...handle,create:() => instance}
    yield ctx.slots.register({name:'main',key:'plugins',locale:namespace,store,inject:() => productFace,children:{
      'plugins.add.actions':{kind:'list',scope:'root'},'plugins.tab':{kind:'list',scope:'root'},'plugins.item':{kind:'list',scope:'root'},
      'plugins.bundle.activation':{kind:'keyed',scope:'root'},'plugins.bundle.config':{kind:'keyed',scope:'root'},'plugins.row.config':{kind:'keyed',scope:'root'},
      'plugins.detail.actions':{kind:'list',scope:'root'},'plugins.detail.badge':{kind:'list',scope:'root'},'plugins.detail.section':{kind:'list',scope:'root'},
    }},PluginManagerPage)
    yield ctx.layout.panelInfo.subscribe(() => {if(ctx.layout.panelInfo.getSnapshot().activePanelId!=='plugins')instance.actions.setView({kind:'list'})})
    const dispose=ctx.reflect.provide('pluginNavigation',{openBundle:(name:string) => {ctx.layout.selectPanel('plugins');instance.actions.setTab('installed');instance.actions.setView({kind:'package',name})}})
    yield () => {void dispose()}
  })
}
