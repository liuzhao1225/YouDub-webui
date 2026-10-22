import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/utils'
import styles from './page-layout.module.css'

type PageProps = HTMLAttributes<HTMLElement> & { as?: 'main' | 'div' | 'section' | 'header' }

/** Shared content boundary; canvas workspaces keep their full-width body. */
export function PageContainer({ as: Component = 'div', className, ...props }: PageProps) {
  return <Component className={cn(styles.container, "@container/page", className)} {...props} />
}
export function Page({ as = 'main', className, ...props }: PageProps) {
  return <PageContainer as={as} className={cn(styles.page, className)} {...props} />
}
export function PageTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h1 className={cn(styles.title, className)} {...props} />
}
export function PageHeader({ title, titleControl, badge, children, actions, leading }: { title: ReactNode; titleControl?: ReactNode; badge?: ReactNode; children?: ReactNode; actions?: ReactNode; leading?: ReactNode }) {
  return <header className={styles.header} data-window-drag>
    <div className={styles.identity}>{leading && <div className={styles.leading}>{leading}</div>}<div className={styles.heading}><div className={styles.titleRow}>{titleControl ?? <PageTitle>{title}</PageTitle>}{badge}</div>{children}</div></div>
    {actions && <div className={styles.actions}>{actions}</div>}
  </header>
}
export const pageLayoutStyles = styles
