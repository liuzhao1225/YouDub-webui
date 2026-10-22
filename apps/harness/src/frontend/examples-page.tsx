import React, { useCallback, useEffect, useRef } from 'react'
import { useFeatures } from './runtime'
import { useText } from './i18n'
import { useTheme } from './theme'

/** Render the source examples document and player without a second implementation. */
export function ExamplesPage({params}:{params:{__search?:string}}) {
  const frame=useRef<HTMLIFrameElement>(null),detach=useRef<(() => void)|undefined>(undefined),{navigate}=useFeatures(),tx=useText(),{theme}=useTheme()
  const syncTheme=useCallback(() => {
    const root=frame.current?.contentDocument?.documentElement
    if(!root)return
    const style=getComputedStyle(frame.current!)
    for(const [target,source] of Object.entries({background:'background',surface:'surface',card:'card',elevated:'elevated',foreground:'foreground',muted:'muted-foreground',border:'border'}))root.style.setProperty(`--${target}`,style.getPropertyValue(`--${source}`))
    root.style.colorScheme=style.colorScheme
  },[])
  useEffect(() => { syncTheme(); const query=matchMedia('(prefers-color-scheme: dark)'); query.addEventListener('change',syncTheme);return () => query.removeEventListener('change',syncTheme) },[theme,syncTheme])
  useEffect(() => () => detach.current?.(),[])
  return <iframe ref={frame} className="yd-original-examples" title={tx("examples.page.built.in.examples")} src={`/api/youdub/examples/index.html${params.__search??''}`} allowFullScreen onLoad={() => {
    syncTheme()
    detach.current?.()
    const document=frame.current?.contentDocument
    if(!document)return
    const back=(event:MouseEvent) => {
      const target=(event.target as Element|null)?.closest('a')
      if(target?.getAttribute('href')==='/'&&!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&!event.altKey){event.preventDefault();navigate('/')}
    }
    document.addEventListener('click',back)
    detach.current=() => document.removeEventListener('click',back)
  }} />
}
