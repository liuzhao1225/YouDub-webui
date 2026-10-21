import React, { useEffect, useRef } from 'react'
import { useFeatures } from './runtime'
import { useText } from './i18n'

/** Render the source examples document and player without a second implementation. */
export function ExamplesPage({params}:{params:{__search?:string}}) {
  const frame=useRef<HTMLIFrameElement>(null),detach=useRef<(() => void)|undefined>(undefined),{navigate}=useFeatures(),tx=useText()
  useEffect(() => () => detach.current?.(),[])
  return <iframe ref={frame} className="yd-original-examples" title={tx('Built-in examples','内置示例','内蔵サンプル')} src={`/api/youdub/examples/index.html${params.__search??''}`} allowFullScreen onLoad={() => {
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
