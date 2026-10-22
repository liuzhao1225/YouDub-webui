import type { ComponentType } from 'react'
import { Link } from '@/plugin/sdk'
import { cn } from '@/lib/utils'
import { Tooltip } from './ui/tooltip'

export function SidebarLink({ href, label, icon: Icon, active, collapsed = false }: {
  href: string; label: string; icon?: ComponentType<{ className?: string }>; active?: boolean; collapsed?: boolean
}) {
  return <Tooltip content={label} side="right" disabled={!collapsed}>
    <Link href={href} aria-current={active ? 'page' : undefined} className={cn(
      'relative flex h-9 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/40',
      active ? 'bg-accent text-foreground before:absolute before:top-1/2 before:left-0 before:h-4 before:w-[3px] before:-translate-y-1/2 before:rounded-full before:bg-[linear-gradient(180deg,var(--brand-pink),var(--brand-blue))]' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
      collapsed && 'size-10 justify-center px-0',
    )}>
      {Icon && <Icon className={cn('size-4 shrink-0', !active && 'text-subtle-foreground')} />}
      <span className={collapsed ? 'sr-only' : undefined}>{label}</span>
    </Link>
  </Tooltip>
}
