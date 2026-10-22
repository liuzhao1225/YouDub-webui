/** Compatibility at the feature boundary; all modal behavior is Harness-owned. */
import React, { Children, createContext, isValidElement, useContext } from 'react'
import { cn } from '../../../web/src/lib/utils'
import layout from '../../../web/src/components/ui/surfaces.module.css'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
const State = createContext<any>(null)
function titleOf(children: React.ReactNode): string {
  return Children.toArray(children).map(child => isValidElement<any>(child) ? child.type === Title ? String(child.props.children) : titleOf(child.props.children) : '').find(Boolean) || ''
}
function Root({ open, onOpenChange, children }: any) { return <State.Provider value={{ open, onOpenChange }}>{children}</State.Provider> }
function Portal({ children }: any) { return children }
function Backdrop() { return null }
function Popup({ children, className }: any) {
  const state = useContext(State)
  return <Modal open={state.open} onClose={() => state.onOpenChange?.(false)} title={titleOf(children)} headless className={cn(layout.dialogContent, className)}><div className="flex min-h-0 flex-col gap-5">{children}</div></Modal>
}
function Title({ children }: any) { return <h2 className="m-0 text-base leading-6 font-medium">{children}</h2> }
export const Dialog = { Root, Portal, Backdrop, Popup, Title }
