// Pill: capsule at the 24px text-line size, selectable when given `onClick`
// (view switcher tabs, filters) and a static span otherwise — TerminalBlock's
// exit status is the read-only case. The 11px read-only badge is `Tag`; size
// separates the two as much as interactivity does.

import type { ButtonHTMLAttributes, ReactNode } from 'react'
import clsx from 'clsx'
import css from './Pill.module.css'

/**
 * Render a pill chip. Interactive when onClick is supplied (renders a button);
 * otherwise a static span.
 * @returns pill element.
 */
export function Pill({ className, children, onClick, ...rest }: {
  // `| undefined` so a caller can forward an optional class straight through
  // under exactOptionalPropertyTypes (a CSS-module lookup is string|undefined).
  className?: string | undefined
  children?: ReactNode
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  if (!onClick) {
    return <span className={clsx(css.pill, className)}>{children}</span>
  }
  return (
    <button
      type="button"
      className={clsx(css.pill, css.interactive, className)}
      onClick={onClick}
      {...rest}
    >
      {children}
    </button>
  )
}
