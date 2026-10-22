import { Children, Fragment, isValidElement, type ReactNode } from 'react'
import type { MenuItem } from './harness-primitives'

type Option = { value?: string | number; children?: ReactNode; disabled?: boolean }
export function childrenItems(children: ReactNode): MenuItem[] {
  return Children.toArray(children).flatMap(child => {
    if (!isValidElement<Option>(child)) return []
    if (child.type === Fragment || child.type === 'optgroup') return childrenItems(child.props.children)
    return [{ id: String(child.props.value ?? child.props.children ?? ''), label: child.props.children, disabled: child.props.disabled }]
  })
}
/** The Menu wrapper participates in the field layout; visual classes belong to its button. */
export function layoutClasses(className = '') {
  return className.split(/\s+/).filter(token => /^(?:(?:sm|md|lg|xl):)?(?:w-|min-w-|max-w-|flex-|grow|shrink|self-|col-span|row-span)/.test(token)).join(' ')
}
