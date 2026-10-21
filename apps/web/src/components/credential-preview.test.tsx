import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { act } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { SavedCredentialPreview } from './saved-credential-preview'

afterEach(cleanup)
const provider = { provider: 'fixture' }
const t = (key: string) => key === 'saved' ? '已保存的 API Key' : '读取密钥摘要失败：'

it('reads the saved preview on each opening and refreshes after the official credential event', async () => {
  let changed = () => {}
  const dispose = vi.fn()
  const subscribe = (listener: () => void) => { changed = listener; return dispose }
  const read = vi.fn().mockResolvedValueOnce({ preview: 'abcdef***' }).mockResolvedValue({ preview: 'uvwxyz***' })
  const props = { provider, configured: true, keyConfigured: true, read, subscribe, t }
  const view = render(<SavedCredentialPreview {...props} />)
  expect(await screen.findByText('abcdef***')).toBeTruthy()
  expect(screen.queryByRole('textbox')).toBeNull()
  await act(async () => changed())
  expect(await screen.findByText('uvwxyz***')).toBeTruthy()
  view.unmount()
  expect(dispose).toHaveBeenCalledTimes(1)
  render(<SavedCredentialPreview {...props} />)
  expect(await screen.findByText('uvwxyz***')).toBeTruthy()
  expect(read).toHaveBeenCalledTimes(3)
})

it('does not request missing credentials and keeps a failed saved-preview read visible', async () => {
  const read = vi.fn().mockRejectedValue(new Error('official service offline'))
  const subscribe = () => () => {}
  const view = render(<SavedCredentialPreview provider={provider} configured keyConfigured={false} read={read} subscribe={subscribe} t={t} />)
  expect(read).not.toHaveBeenCalled()
  view.rerender(<SavedCredentialPreview provider={provider} configured keyConfigured read={read} subscribe={subscribe} t={t} />)
  expect(await screen.findByRole('alert')).toHaveTextContent('official service offline')
  expect(screen.queryByText('已保存的 API Key')).toBeNull()
})
