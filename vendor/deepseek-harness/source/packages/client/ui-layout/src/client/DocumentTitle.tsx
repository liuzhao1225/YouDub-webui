/** Product title projection without a chat-session dependency. */
import { useEffect } from 'react'

/** Props for the browser title projection. */
export type DocumentTitleProps = {
  /** Build-configured or localized product title. */
  productTitle: string
}

/**
 * Project the build-selected product title without reading Session state.
 * @param props - Product title supplied by the frame.
 * @returns No rendered content.
 */
export function DocumentTitle({ productTitle }: DocumentTitleProps): null {
  useEffect(() => {
    document.title = productTitle
  }, [productTitle])
  return null
}
