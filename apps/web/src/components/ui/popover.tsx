import { useState, type ReactNode } from 'react'
import { Button } from './button'
import { Menu } from './harness-primitives'

/** Freeform workflow fields use the same Harness surface as other compact menus. */
export function FieldPopover({ label, trigger, disabled, className, children }: {
  label: string
  trigger: ReactNode
  disabled?: boolean
  className?: string
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  return <Menu portal autoFocus open={open} onClose={() => setOpen(false)} anchor={
    <Button type="button" variant="outline" disabled={disabled} className={className}
      aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
      {trigger}
    </Button>
  }>
    <div role="group" aria-label={label} className="yd-quick-fields">{children}</div>
  </Menu>
}
