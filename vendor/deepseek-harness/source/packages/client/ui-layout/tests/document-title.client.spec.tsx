// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { DocumentTitle } from '../src/client/DocumentTitle.tsx'

let originalTitle: string
beforeEach(() => { originalTitle = document.title })
afterEach(() => {
  try { cleanup() } finally { document.title = originalTitle }
})

describe('DocumentTitle', () => {
  it('projects the product title without Session hooks', () => {
    document.title = 'stale title'
    const mounted = render(<DocumentTitle productTitle="YouDub" />)
    expect(document.title).toBe('YouDub')
    mounted.unmount()
    expect(document.title).toBe('YouDub')
  })

  it('follows the localized product title supplied by the frame', () => {
    const mounted = render(<DocumentTitle productTitle="YouDub Local Build" />)
    expect(document.title).toBe('YouDub Local Build')
    mounted.rerender(<DocumentTitle productTitle="YouDub" />)
    expect(document.title).toBe('YouDub')
    mounted.unmount()
    expect(document.title).toBe('YouDub')
  })
})
