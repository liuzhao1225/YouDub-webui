import type { DetailsHTMLAttributes, ReactNode } from 'react'
import styles from '../../../../../vendor/deepseek-harness/source/packages/client/ui-primitives/src/DisclosureRow.module.css'
import local from './disclosure.module.css'
import surface from './surfaces.module.css'
import { ChevronRight } from '@/lib/icons'
import { cn } from '@/lib/utils'
export function Disclosure({ title, children, className, contained = true, inline = false, ...props }: Omit<DetailsHTMLAttributes<HTMLDetailsElement>, 'title'> & { title: ReactNode; contained?: boolean; inline?: boolean }) {
  return <details {...props} className={cn(local.root, inline && local.inline, contained && [surface.surface, local.contained], className)}><summary className={cn(styles.row, local.summary)}><span className={styles.leading}><ChevronRight aria-hidden="true" /></span><span className={cn(styles.title, local.title)}>{title}</span></summary><div className={local.content}>{children}</div></details>
}
