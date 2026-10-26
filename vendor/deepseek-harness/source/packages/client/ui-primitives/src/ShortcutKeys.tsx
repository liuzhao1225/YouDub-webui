/** Shared shortcut keycaps; callers supply the effective platform presentation. */
import css from './ShortcutKeys.module.css'
import clsx from 'clsx'

/**
 * Render one command's keycaps without owning binding defaults or localized copy.
 * @param props - effective key labels, presentation variant.
 * @returns unboxed keys by default, or tooltip keycaps with plus-separated combinations grouped together.
 */
export function ShortcutKeys({ keys, variant = 'plain' }: { keys: readonly string[]; variant?: 'plain' | 'tooltip' }) {
  return <span className={clsx(css.keys, variant === 'tooltip' && css.tooltip, variant === 'tooltip' && keys.includes('+') && css.joined)}>{keys.map((key, index) => <kbd key={index} className={key === '+' ? css.separator : css.key}>{key}</kbd>)}</span>
}
