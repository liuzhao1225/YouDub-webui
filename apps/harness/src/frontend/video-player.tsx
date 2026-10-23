import React, { useState } from 'react'
import { Button, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import { VideoPlayer as DomainVideoPlayer, type SpeedControlProps } from '../../../web/src/components/video-player'

function SpeedControl({rate,options,label,onChange}:SpeedControlProps) {
  const [open,setOpen]=useState(false)
  return <Menu portal open={open} selectedId={String(rate)} items={options.map(rate => ({id:String(rate),label:`${rate}x`}))} onClose={() => setOpen(false)} onSelect={value => {onChange(Number(value));setOpen(false)}} anchor={<Button className="!text-white hover:!bg-white/15 !min-w-9 !h-9" variant="ghost" aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>{rate}x</Button>} />
}
export function VideoPlayer(props:React.ComponentProps<typeof DomainVideoPlayer>) { return <DomainVideoPlayer {...props} renderSpeedControl={props => <SpeedControl {...props}/>} /> }
