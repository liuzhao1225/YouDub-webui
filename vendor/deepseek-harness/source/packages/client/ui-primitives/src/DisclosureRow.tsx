import { memo, type KeyboardEvent, type ReactNode } from 'react'
import clsx from 'clsx'
import { IconChevronDownOutlineRegular, IconChevronUpOutlineRegular } from './icons/index.tsx'
import css from './DisclosureRow.module.css'

/** Controlled disclosure header with shared typography and keyboard behavior. */
export interface DisclosureRowProps {
  icon: ReactNode
  title: string
  open: boolean
  onToggle: () => void
  children?: ReactNode
  className?: string | undefined
}

export const DisclosureRow = memo(function DisclosureRow({
  icon, title, open, onToggle, children, className,
}: DisclosureRowProps) {
  const toggleFromKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    onToggle()
  }
  return (
    <div className={clsx(css.root, className)} data-open={open || undefined}>
      <div className={css.header} data-disclosure-header>
        <div className={css.row} data-disclosure-row
          role="button" tabIndex={0} aria-expanded={open}
          onClick={onToggle} onKeyDown={toggleFromKeyboard}>
          <span className={css.leading}>
            {open ? <IconChevronUpOutlineRegular /> : <>
              <span className={css.iconIdle}>{icon}</span>
              <IconChevronDownOutlineRegular className={css.chevronHover} />
            </>}
          </span>
          <span className={css.title}>{title}</span>
        </div>
      </div>
      {open && children}
    </div>
  )
})
