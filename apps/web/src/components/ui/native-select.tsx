import { useState, type ComponentProps, type ReactNode } from 'react'
import { IconChevronDown } from '@tabler/icons-react'
import { Button, Checkbox, Menu } from './harness-primitives'
import { childrenItems, layoutClasses } from './menu-options'
import { cn } from '@/lib/utils'

type FieldChange<T> = { target: T; currentTarget: T }
type Props = Pick<ComponentProps<typeof Button>, 'id' | 'disabled' | 'className' | 'title' | 'aria-label' | 'aria-labelledby'> & {
  children: ReactNode
  value?: string | number
  defaultValue?: string | number
  onChange?: (event: FieldChange<{ value: string }>) => void
}
/** Preserve domain field callbacks while Harness Menu owns focus, keyboard and portal behavior. */
export function NativeSelect({ children, value, defaultValue = '', onChange, disabled, className, ...props }: Props) {
  const [open, setOpen] = useState(false)
  const [local, setLocal] = useState(defaultValue)
  const items = childrenItems(children), current = String(value ?? local)
  const selected = items.find(item => item.id === current)
  return <Menu open={open} portal autoFocus selectedId={current} items={items} onClose={() => setOpen(false)} onSelect={next => {
    setLocal(next)
    onChange?.({ target: { value: next }, currentTarget: { value: next } })
    setOpen(false)
  }} className={cn('yd-select', layoutClasses(className))} anchor={<Button {...props} type="button" variant="outline" disabled={disabled} className={cn('gap-2 [&_svg]:size-4 [&_svg]:shrink-0', className)} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} onKeyDown={event => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true) }
  }}>{selected?.label ?? items[0]?.label ?? '—'}<IconChevronDown aria-hidden="true" /></Button>} />
}

type ChoiceProps = Omit<ComponentProps<typeof Checkbox>, 'label' | 'onChange'> & {
  label?: string
  'aria-label'?: string
  onChange: (event: FieldChange<{ checked: boolean }>) => void
}
export function Choice({ onChange, label, 'aria-label': ariaLabel, ...props }: ChoiceProps) {
  return <Checkbox {...props} label={label ?? ariaLabel ?? ''} onChange={checked => onChange({ target: { checked }, currentTarget: { checked } })} />
}
