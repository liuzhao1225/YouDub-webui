import type { ReactNode } from 'react'
import { CircleAlert, Info, TriangleAlert } from '@/lib/icons'
import { cn } from '@/lib/utils'
import styles from './ui/surfaces.module.css'
const icons = { danger: CircleAlert, warning: TriangleAlert, info: Info }
export function InlineAlert({ tone = 'danger', children, className }: { tone?: keyof typeof icons; children: ReactNode; className?: string }) {
  const Icon = icons[tone]
  return <div role={tone === 'danger' ? 'alert' : 'status'} data-tone={tone} className={cn(styles.alert, className)}><Icon aria-hidden="true" /><div className="min-w-0 flex-1 break-words">{children}</div></div>
}
