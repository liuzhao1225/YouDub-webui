import type { HTMLAttributes } from 'react'
import styles from './surfaces.module.css'
import { cn } from '@/lib/utils'
export function Surface({ as: Component = 'section', className, ...props }: HTMLAttributes<HTMLElement> & { as?: 'section' | 'div' | 'article' | 'dl' | 'ol' }) {
  return <Component {...props} className={cn(styles.surface, className)} />
}
