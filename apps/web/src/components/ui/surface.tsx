import type { HTMLAttributes } from 'react'
import styles from './surfaces.module.css'
import { cn } from '@/lib/utils'
import { cva } from 'class-variance-authority'

/** Links keep native navigation semantics and share the same card surface. */
export const surfaceVariants = cva(styles.surface, { variants: { interactive: { true: styles.interactive } } })

export function Surface({ as: Component = 'section', className, ...props }: HTMLAttributes<HTMLElement> & { as?: 'section' | 'div' | 'article' | 'dl' | 'ol' | 'form' | 'fieldset' }) {
  return <Component {...props} className={cn(surfaceVariants(), className)} />
}
