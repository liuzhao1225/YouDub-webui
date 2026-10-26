import { useEffect, useLayoutEffect, useRef } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import css from './Toast.module.css'

/** Full-opacity hold before the fade starts, when the owner names none. */
const HOLD_MS = 3000
/** Fade duration. Must agree with the stylesheet's toast-fade duration. */
const FADE_MS = 1000

/**
 * Transient top-center banner: slides in, holds at full opacity, fades out,
 * then reports done so the owner can unmount it. Re-showing the same text
 * restarts the cycle when the owner remounts the component (key it by a
 * per-show sequence). Rendered through a body portal so an owner inside a
 * transformed or filtered ancestor cannot trap the fixed banner in that
 * ancestor's box.
 * With unchanged holdMs, parent rerenders do not extend the lifetime.
 * Completion calls the latest onDone handler.
 *
 * The hold is the owner's to set, because how long a banner has to stay
 * depends on how much there is to read: a one-line limit lands in the default
 * window, while a failure that names what broke does not. One value drives
 * both the unmount timer and the stylesheet's fade delay — the stylesheet
 * reads it as a custom property — so the two can no longer disagree and leave
 * the banner unmounting mid-fade.
 * @param props.text - resolved banner copy; the owner passes localized text.
 * @param props.icon - optional leading glyph.
 * @param props.holdMs - full-opacity hold before the fade; defaults to 3000.
 * @param props.onDone - called once the fade completes; unmount the toast here.
 * @returns the floating banner.
 */
export function Toast({ text, icon, holdMs = HOLD_MS, onDone }: {
  text: string
  icon?: ReactNode
  holdMs?: number
  onDone: () => void
}) {
  const latestOnDone = useRef(onDone)
  useLayoutEffect(() => { latestOnDone.current = onDone }, [onDone])
  useEffect(() => {
    const timer = setTimeout(() => { latestOnDone.current() }, holdMs + FADE_MS)
    return () => { clearTimeout(timer) }
  }, [holdMs])
  return createPortal(
    <div
      className={css.toast}
      role="alert"
      style={{
        '--dsh-toast-hold': `${String(holdMs)}ms`,
      } as CSSProperties}
    >
      {icon !== undefined && <span className={css.icon} aria-hidden>{icon}</span>}
      <span className={css.text}>{text}</span>
    </div>,
    document.body,
  )
}
