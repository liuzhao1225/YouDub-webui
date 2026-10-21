import React from 'react'
import { StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
export function InlineAlert({ children, tone = 'danger', className = '' }: { children:React.ReactNode; tone?:string; className?:string }) { return <div role="alert" className={`yd-domain-alert ${className}`}><StateDot state={tone === 'warning' ? 'warning' : 'error'} /><div>{children}</div></div> }
