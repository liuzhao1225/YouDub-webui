/** Compatibility at the feature boundary; all modal behavior is Harness-owned. */
import React, { Children, createContext, isValidElement, useContext } from 'react'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
const State = createContext<any>(null)
function titleOf(children: React.ReactNode): string {
  return Children.toArray(children).map(child => isValidElement<any>(child) ? child.type === Title ? String(child.props.children) : titleOf(child.props.children) : '').find(Boolean) || ''
}
function Root({ open, onOpenChange, children }: any) { return <State.Provider value={{ open, onOpenChange }}>{children}</State.Provider> }
function Portal({ children }: any) { return children }
function Backdrop() { return null }
function Popup({ children }: any) {
  const state = useContext(State)
  return <Modal open={state.open} onClose={() => state.onOpenChange?.(false)} title={titleOf(children)} headless><div className="yd-domain-dialog">{children}</div></Modal>
}
function Title({ children }: any) { return <h2>{children}</h2> }
export const Dialog = { Root, Portal, Backdrop, Popup, Title }
