import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/utils'

type PageProps = HTMLAttributes<HTMLElement> & {
  as?: 'main' | 'div' | 'section' | 'header'
}

/** Shared content boundary; canvas workspaces keep their full-width layout. */
export function PageContainer({ as: Component = 'div', className, ...props }: PageProps) {
  return <Component className={cn('@container/page mx-auto w-full min-w-0 max-w-6xl px-4 sm:px-8', className)} {...props} />
}

export function Page({ as = 'main', className, ...props }: PageProps) {
  return <PageContainer as={as} className={cn('space-y-6 py-6', className)} {...props} />
}

export function PageHeader({ title, children, actions }: { title: ReactNode; children?: ReactNode; actions?: ReactNode }) {
  return <header className="flex flex-wrap items-start justify-between gap-4">
    <div className="min-w-0 flex-1"><h1 className="break-words text-2xl leading-8 font-semibold tracking-tight">{title}</h1>{children}</div>
    {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
  </header>
}
