import { Children, createContext, isValidElement, useContext, useState, type ComponentProps, type ReactNode } from 'react'
import { IconChevronDown } from '@tabler/icons-react'
import { Button, Menu } from './harness-primitives'
import { childrenItems, layoutClasses } from './menu-options'
import { cn } from '@/lib/utils'

const SelectContext = createContext<{ open: boolean; setOpen: (open: boolean) => void } | null>(null)
type Props = { children: ReactNode; value?: string; defaultValue?: string; onValueChange?: (value: string) => void }
type TriggerProps = ComponentProps<typeof Button> & { showChevron?: boolean }

export function Select({ children, value, defaultValue = '', onValueChange }: Props) {
  const [open, setOpen] = useState(false), [local, setLocal] = useState(defaultValue)
  const parts = Children.toArray(children).filter(isValidElement<{ children?: ReactNode; className?: string }>)
  const trigger = parts.find(child => child.type === SelectTrigger)
  const content = parts.find(child => child.type === SelectContent)
  return <SelectContext.Provider value={{ open, setOpen }}><Menu open={open} portal autoFocus items={childrenItems(content?.props.children)} selectedId={value ?? local} onClose={() => setOpen(false)} onSelect={next => {
    setLocal(next); onValueChange?.(next); setOpen(false)
  }} anchor={trigger} className={cn('yd-select w-full', layoutClasses(trigger?.props.className))} /></SelectContext.Provider>
}
export function SelectTrigger({ children, className, showChevron = true, ...props }: TriggerProps) {
  const state = useContext(SelectContext)
  if (!state) throw new Error('SelectTrigger requires Select')
  return <Button {...props} className={cn('w-full min-w-0 justify-between gap-2 [&_svg]:size-4 [&_svg]:shrink-0', className)} type="button" variant="outline" aria-haspopup="menu" aria-expanded={state.open} onClick={() => state.setOpen(!state.open)} onKeyDown={event => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); state.setOpen(true) }
  }}>{children}{showChevron && <IconChevronDown aria-hidden="true" />}</Button>
}
export function SelectContent({ children }: { children: ReactNode }) { return children }
export function SelectItem({ children }: { children: ReactNode; value: string; disabled?: boolean }) { return children }
