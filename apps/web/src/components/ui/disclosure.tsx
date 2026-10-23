import { useEffect, useState, type ReactNode } from 'react'
import { DisclosureRow } from './harness-primitives'
import local from './disclosure.module.css'
import surface from './surfaces.module.css'
import { ChevronRight } from '@/lib/icons'
import { cn } from '@/lib/utils'

/** Harness owns disclosure keyboard handling, chevrons, type and states. */
export function Disclosure({ title, children, className, contained = true, inline = false, open = false, onOpenChange }: {
  title: string; children: ReactNode; className?: string; contained?: boolean; inline?: boolean
  open?: boolean; onOpenChange?: (open: boolean) => void
}) {
  const [expanded, setExpanded] = useState(open)
  useEffect(() => setExpanded(open), [open])
  return <DisclosureRow title={title} icon={<ChevronRight aria-hidden="true" />} open={expanded} expandable expandOnRowClick
    onToggle={() => { const next = !expanded; setExpanded(next); onOpenChange?.(next) }}
    className={cn(inline && local.inline, contained && [surface.surface, local.contained], className)}>
    <div className={local.content}>{children}</div>
  </DisclosureRow>
}
