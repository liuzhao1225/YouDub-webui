import type { ReactNode } from 'react'
import { BrandMark } from './brand/brand-mark'
import { Page, pageLayoutStyles } from './page-layout'

/** Shared boundary for installation, preparation and provider configuration. */
export function SetupPage({ children, actions, wordmarkSrc, className }: {
  children: ReactNode; actions?: ReactNode; wordmarkSrc: string; className?: string
}) {
  return <Page width="form" className={className}>
    <header className={`${pageLayoutStyles.header} items-center`}>
      <span aria-label="YouDub" className="shrink-0"><BrandMark animated wordmark wordmarkSrc={wordmarkSrc} className="h-7" /></span>
      {actions && <div className="ml-auto flex flex-wrap items-center justify-end gap-2">{actions}</div>}
    </header>
    {children}
  </Page>
}
