import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Page, PageHeader } from '../../../web/src/components/page-layout'
import { Button } from '../../../web/src/components/ui/button'
import { useFeatures } from './runtime'
import { useText } from './i18n'
import { useTheme } from './theme'
import buttonCss from '../../../../vendor/deepseek-harness/source/packages/client/ui-primitives/src/Button.module.css?inline'
import segmentedCss from '../../../../vendor/deepseek-harness/source/packages/client/ui-primitives/src/SegmentedControl.module.css?inline'

// The paired-language player remains the original document. Its outer page and
// controls consume the same layout, primitive CSS and theme as the application.
export function ExamplesPage({params,fromSetup=false}:{params:{__search?:string};fromSetup?:boolean}) {
  const frame=useRef<HTMLIFrameElement>(null),detach=useRef<(() => void)|undefined>(undefined),{navigate}=useFeatures(),tx=useText(),{theme}=useTheme()
  const [loadedSource,setLoadedSource]=useState<string>()
  const source=`/api/youdub/examples/index.html${params.__search??''}`
  const syncTheme=useCallback(() => {
    const root=frame.current?.contentDocument?.documentElement
    if(!root)return
    const style=getComputedStyle(frame.current!)
    for(const name of Array.from(style)) if(name.startsWith('--dsw-'))root.style.setProperty(name,style.getPropertyValue(name))
    for(const [target,source] of Object.entries({background:'background',surface:'surface',card:'card',elevated:'elevated',foreground:'foreground',muted:'muted-foreground',border:'border'}))root.style.setProperty(`--${target}`,style.getPropertyValue(`--${source}`))
    root.style.colorScheme=style.colorScheme
  },[])
  useEffect(() => { syncTheme(); const query=matchMedia('(prefers-color-scheme: dark)'); query.addEventListener('change',syncTheme);return () => query.removeEventListener('change',syncTheme) },[theme,syncTheme])
  useEffect(() => () => detach.current?.(),[])
  return <Page><PageHeader title={tx('examples.page.built.in.examples')} actions={<Button size="sm" variant="ghost" onClick={() => navigate('/')}>{tx(fromSetup ? 'examples.page.back.to.setup' : 'client.workbench')}</Button>} />
    {loadedSource!==source && <p role="status" className="text-sm text-muted-foreground">{tx('library.loading')}</p>}
    <iframe ref={frame} className="yd-original-examples" title={tx('examples.page.built.in.examples')} src={source} allowFullScreen onLoad={() => {
      setLoadedSource(source)
      detach.current?.()
      const doc=frame.current?.contentDocument
      if(!doc)return
      syncTheme()
      const styles=doc.createElement('style')
      styles.textContent=buttonCss.replace(/\.([a-zA-Z_][\w-]*)/g,(_,name)=>`.yd-example-${name}`)+segmentedCss.replace(/\.control\b/g,'body .language-tabs').replace(/\.tab\b/g,'body .language-tabs button').replace(/\.indicator\b/g,'.yd-example-indicator')+`
        html { overflow:hidden; }
        body { display:flow-root; margin:0; background:transparent; font-family:var(--dsw-font-family); }
        body::before { display:none; }
        .start-overlay { color:white; }
        .site-header,.demo-topline { display:none; }
        .examples.wrap { width:100%; max-width:none; margin:0; padding:0; }
        .demo-picker,.player { max-width:none; width:100%; }
        .sample { height:auto; justify-content:flex-start; padding:8px 14px; }
        .sample.is-selected { border-color:var(--dsw-alias-border-l4); box-shadow:none; background:var(--dsw-alias-bg-layer-1); }
        .player { border:.5px solid var(--dsw-alias-border-l2); border-radius:var(--dsw-radius-lg); box-shadow:none; }
        .player:fullscreen {
          --dsw-alias-label-primary:var(--foreground);
          --dsw-alias-label-secondary:var(--muted);
          --dsw-alias-bg-layer-1:var(--elevated);
          --dsw-alias-interactive-bg-hover:var(--border);
        }
        body .language-tabs { border:0; }
        body .language-tabs button[aria-selected=true] { background:transparent; box-shadow:none; }
      `
      doc.head.append(styles)
      doc.querySelectorAll('.sample').forEach(button=>button.classList.add('yd-example-button','yd-example-outline'))
      const tabs=Array.from(doc.querySelectorAll<HTMLElement>('.language-tabs'))
      for(const list of tabs){const indicator=doc.createElement('span');indicator.className='yd-example-indicator';indicator.setAttribute('aria-hidden','true');list.prepend(indicator);list.style.setProperty('--dsh-segment-count','2')}
      const updateTabs=()=>tabs.forEach(list=>list.style.setProperty('--dsh-segment-index',String(Array.from(list.querySelectorAll('[role=tab]')).findIndex(tab=>tab.getAttribute('aria-selected')==='true'))))
      updateTabs()
      const changes=new MutationObserver(updateTabs)
      tabs.forEach(list=>changes.observe(list,{subtree:true,attributes:true,attributeFilter:['aria-selected']}))
      const resize=new ResizeObserver(()=>{if(frame.current)frame.current.style.height=`${Math.ceil(doc.body.getBoundingClientRect().height)}px`})
      resize.observe(doc.body)
      detach.current=()=>{changes.disconnect();resize.disconnect()}
    }} />
  </Page>
}
