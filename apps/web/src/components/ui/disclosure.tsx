import { useState, type ReactNode } from 'react'
import { DisclosureRow } from './harness-primitives'
import local from './disclosure.module.css'
import surface from './surfaces.module.css'
import { ChevronRight } from '@/lib/icons'
import { cn } from '@/lib/utils'

/** Harness owns disclosure keyboard handling, chevrons, type and states. */
export function Disclosure({ title, children, contained = true, inline = false, open = false, onOpenChange }: {
  title: string; children: ReactNode; contained?: boolean; inline?: boolean
  open?: boolean; onOpenChange?: (open: boolean) => void
}) {
  const [state, setState] = useState({ source: open, expanded: open })
  if (state.source !== open) setState({ source: open, expanded: open })
  const { expanded } = state
  return <DisclosureRow title={title} icon={<ChevronRight aria-hidden="true" />} open={expanded}
    onToggle={() => { const next = !expanded; setState({ source: open, expanded: next }); onOpenChange?.(next) }}
    className={cn(inline && local.inline, contained && [surface.surface, local.contained])}>
    <div className={local.content}>{children}</div>
  </DisclosureRow>
}
