/** Domain contracts remain portable; navigation is supplied by the Harness page store. */
export type * from '../../../web/src/plugin/sdk'
import React, { createContext, useContext } from 'react'
export const NavigationContext = createContext<(path:string) => void>(() => { throw new Error('YouDub page navigation is unavailable') })
export function Link({ href='/', onClick, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  const navigate = useContext(NavigationContext)
  return <a {...props} href={href} onClick={event => { onClick?.(event); if (!event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && !props.target && href.startsWith('/')) { event.preventDefault(); navigate(href) } }}>{children}</a>
}

export {text,matchRoute} from '../../../web/src/plugin/domain-helpers'
