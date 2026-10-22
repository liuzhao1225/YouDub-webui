/** YouDub prop vocabulary mapped to unchanged Harness controls. */
import React, { Children, Fragment, createContext, forwardRef, isValidElement, useContext, useId, useState } from 'react'
import { Button as HarnessButton, Input as HarnessInput, Menu, Checkbox, Switch as HarnessSwitch, SegmentedControl, Tooltip as HarnessTooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { IconChevronDown } from '@tabler/icons-react'
import state from '../../../web/src/components/ui/control-state.module.css'
import { cn } from '../../../web/src/lib/utils'
export { buttonVariants } from '../../../web/src/components/ui/button-styles'
export const Button = forwardRef<HTMLButtonElement, any>(function Button({ variant = 'default', size = 'default', className = '', ...props }, ref) {
  const variants: Record<string, any> = { default:'primary', primary:'primary', outline:'outline', secondary:'outline', tint:'ghost', ghost:'ghost', destructive:'outline', link:'ghost', toolbar:'toolbar' }
  return <HarnessButton {...props} ref={ref} variant={variants[variant] ?? variant} size={['xs','sm','icon-xs','icon-sm'].includes(size) ? 'sm' : 'md'} className={cn('[&_svg]:size-4 [&_svg]:shrink-0',size.startsWith('icon')&&'p-0',size==='icon-xs'&&'size-7',size==='icon-sm'&&'size-8',size==='icon'&&'size-9',size==='icon-lg'&&'size-10',variant==='destructive'&&'text-status-danger-fg',variant==='link'&&'text-link',size==='xl'&&'h-11',className)} />
})
export const Input = forwardRef<HTMLInputElement,React.ComponentProps<typeof HarnessInput>>(function Input({className,...props},ref) { return <HarnessInput {...props} ref={ref} className={cn(state.input,'w-full min-w-0',className)} /> })
export function Label(props: React.LabelHTMLAttributes<HTMLLabelElement>) { return <label {...props} /> }
export function Tooltip({ content, children, side = 'top' }: any) { return <HarnessTooltip portal label={typeof content === 'string' ? content : String(content ?? '')} side={side === 'left' ? 'right' : side}>{children}</HarnessTooltip> }
function childrenItems(children: React.ReactNode): { id:string; label:React.ReactNode; disabled?:boolean }[] {
  return Children.toArray(children).flatMap(child => {
    if (!isValidElement<any>(child)) return []
    if (child.type === Fragment || child.type === 'optgroup') return childrenItems(child.props.children)
    return [{ id:String(child.props.value ?? child.props.children ?? ''), label:child.props.children, disabled:child.props.disabled }]
  })
}
/** Select semantics are translated once; Harness Menu owns focus, keyboard and portal. */
export function NativeSelect({ children, value, defaultValue, onChange, disabled, className, id, title, ...props }: any) {
  const [open, setOpen] = useState(false), [local, setLocal] = useState(defaultValue ?? '')
  const items = childrenItems(children), current = String(value ?? local), selected = items.find(item => item.id === current)
  return <Menu open={open} portal autoFocus selectedId={current} items={items} onClose={() => setOpen(false)} onSelect={next => { setLocal(next); onChange?.({ target:{ value:next }, currentTarget:{ value:next } }); setOpen(false) }} className={cn('yd-select',layoutClasses(className))} anchor={<HarnessButton id={id} type="button" variant="outline" className={cn('gap-2 [&_svg]:size-4 [&_svg]:shrink-0',className)} title={title} disabled={disabled} aria-label={props['aria-label']} aria-labelledby={props['aria-labelledby']} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} onKeyDown={event => {if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();setOpen(true)}}}>{selected?.label ?? items[0]?.label ?? '—'}<IconChevronDown aria-hidden="true" /></HarnessButton>} />
}
function layoutClasses(className='') { return className.split(/\s+/).filter((token:string) => /^(?:(?:sm|md|lg|xl):)?(?:w-|min-w-|max-w-|flex-|grow|shrink|self-|col-span|row-span)/.test(token)).join(' ') }
const SelectContext = createContext<any>(null)
export function Select({ children, value, defaultValue, onValueChange }: any) {
  const [open, setOpen] = useState(false), [local, setLocal] = useState(defaultValue)
  const parts = Children.toArray(children).filter(isValidElement<any>)
  const trigger = parts.find(child => child.type === SelectTrigger), content = parts.find(child => child.type === SelectContent)
  const items = childrenItems(content?.props.children)
  return <SelectContext.Provider value={{ open, setOpen }}><Menu open={open} portal autoFocus items={items} selectedId={String(value ?? local ?? '')} onClose={() => setOpen(false)} onSelect={next => { setLocal(next); onValueChange?.(next); setOpen(false) }} anchor={trigger} className={cn('yd-select w-full',layoutClasses(trigger?.props.className))} /></SelectContext.Provider>
}
export function SelectTrigger({ children, className, showChevron = true, ...props }: any) { const state = useContext(SelectContext); return <HarnessButton {...props} className={cn('w-full min-w-0 justify-between gap-2 [&_svg]:size-4 [&_svg]:shrink-0',className)} type="button" variant="outline" aria-haspopup="menu" aria-expanded={state.open} onClick={() => state.setOpen(!state.open)} onKeyDown={event => {if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();state.setOpen(true)}}}>{children}{showChevron && <IconChevronDown aria-hidden="true" />}</HarnessButton> }
export function SelectContent({ children }: any) { return children }
export function SelectItem({ children }: any) { return children }
/** Native change-shaped adapter for legacy domain field callbacks. */
export function Choice({ checked, onChange, disabled, title, label, 'aria-label': ariaLabel, className }: any) {
  return <Checkbox checked={!!checked} disabled={disabled} title={title} label={label ?? ariaLabel ?? ''} className={className} onChange={next => onChange?.({ target:{ checked:next }, currentTarget:{ checked:next } })} />
}
export function Switch({ checked, onCheckedChange, onChange, label, 'aria-label':ariaLabel, disabled, title, className }:any) { return <HarnessSwitch checked={!!checked} onChange={onCheckedChange ?? onChange} label={label ?? ariaLabel ?? ''} disabled={disabled} title={title} className={className} /> }
export function Segmented({ id, value,onChange,options,ariaLabel,className,disabled }:any) { const generatedId=useId(); return <SegmentedControl id={id ?? generatedId} value={value} onChange={onChange} label={ariaLabel} disabled={disabled} className={cn('inline-grid [&_svg]:size-4 [&_svg]:shrink-0',className)} options={options} /> }

export { Tag } from '@deepseek-ai/dsh-client-ui-primitives'
