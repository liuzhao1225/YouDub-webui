import { createContext, useContext, type HTMLAttributes, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'
import styles from './page-layout.module.css'
import nativeHeader from '../../../../vendor/deepseek-harness/source/packages/client/ui-layout/src/client/ConversationRoot.module.css'

type PageProps = HTMLAttributes<HTMLElement> & { as?: 'main' | 'div' | 'section' | 'header' }
const WindowHeaderContext = createContext<HTMLElement | null | undefined>(undefined)
export const WindowHeaderProvider = WindowHeaderContext.Provider
export function useWindowHeader() { return useContext(WindowHeaderContext) !== undefined }

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
  const host = useContext(WindowHeaderContext)
  if (host !== undefined) return <>{host && createPortal(<>
    <div className={nativeHeader.titleCluster}>
      {leading && <div className={nativeHeader.headerLeading}>{leading}</div>}
      <div className={nativeHeader.crumbs}>{titleControl ?? <h1 className={cn(nativeHeader.crumb, nativeHeader.crumbCurrent)} style={{ margin: 0 }}>{title}</h1>}</div>
      {badge}
    </div>
    {actions && <div className={nativeHeader.headerActions}>{actions}</div>}
  </>, host)}{children && <div>{children}</div>}</>
  return <header className={styles.header} data-window-drag>
    <div className={styles.identity}>{leading && <div className={styles.leading}>{leading}</div>}<div className={styles.heading}><div className={styles.titleRow}>{titleControl ?? <PageTitle>{title}</PageTitle>}{badge}</div>{children}</div></div>
    {actions && <div className={styles.actions}>{actions}</div>}
  </header>
}
export const pageLayoutStyles = styles
