import React, { Children, createContext, isValidElement, useContext, useState } from 'react'
import { Button, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
const State = createContext<any>(null)
function Root({ children }: any) {
  const [open, setOpen] = useState(false), parts = Children.toArray(children).filter(isValidElement<any>)
  const trigger = parts.find(child => child.type === Trigger), content = parts.filter(child => child.type !== Trigger)
  return <State.Provider value={{ open, setOpen }}><Menu portal open={open} onClose={() => setOpen(false)} anchor={trigger}>{content}</Menu></State.Provider>
}
function Trigger(props:any) { const state = useContext(State); return <Button {...props} type="button" variant="outline" aria-haspopup="dialog" aria-expanded={state.open} onClick={() => state.setOpen(!state.open)} /> }
function Passthrough({ children }:any) { return children }
function Popup({ children, 'aria-label':label }:any) { return <div role="group" aria-label={label} className="yd-quick-fields">{children}</div> }
export const Popover = { Root, Trigger, Portal:Passthrough, Positioner:Passthrough, Popup }
