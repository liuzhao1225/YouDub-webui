import { useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { LanguageProvider } from '@/lib/i18n'
import { ConnectionForm } from './connection-form'

const connection = { adapter: 'openai', base_url: 'https://example.test/v1', model: 'qwen-max', has_api_key: true, api_key_hint: 'sk-abc****' }
const settings = { connections: [connection] }
afterEach(cleanup)

it('uses the key hint as a placeholder and requests a new key when the address changes', async () => {
  const request = vi.fn().mockResolvedValue(settings)
  render(<LanguageProvider><ConnectionForm request={request} /></LanguageProvider>)
  const key = await screen.findByLabelText('API 密钥 · 已保存')
  expect(key).toHaveValue('')
  expect(key).toHaveAttribute('placeholder', 'sk-abc****')
  expect(screen.queryByRole('heading')).not.toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('服务地址'), { target: { value: 'https://different.test/v1' } })
  expect(key).toBeRequired()
  expect(key).toHaveAttribute('placeholder', '')
  expect(screen.getByRole('button', { name: '测试连接' })).toBeDisabled()
})

it('reports actual dirty changes with inline callbacks and leaves them dirty after a test', async () => {
  const request = vi.fn().mockResolvedValueOnce(settings).mockResolvedValue({ ok: true })
  function View() {
    const [state, setState] = useState({ dirty: false })
    return <><output>{state.dirty ? '修改未保存' : '没有修改'}</output><ConnectionForm request={request} onDirtyChange={dirty => setState({ dirty })} /></>
  }
  render(<LanguageProvider><View /></LanguageProvider>)
  const model = await screen.findByLabelText('模型名称')
  expect(screen.getByText('没有修改')).toBeInTheDocument()
  fireEvent.change(model, { target: { value: 'new-model' } })
  expect(screen.getByText('修改未保存')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '测试连接' }))
  expect(await screen.findByText(/连接测试通过/)).toBeInTheDocument()
  expect(screen.getByText('修改未保存')).toBeInTheDocument()
  fireEvent.change(model, { target: { value: 'qwen-max' } })
  expect(screen.getByText('没有修改')).toBeInTheDocument()
  expect(screen.queryByText(/连接测试通过/)).not.toBeInTheDocument()
  expect(request.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(0)
})

it('clears the saved key explicitly and resets the dirty guard only after readback', async () => {
  const onDirtyChange = vi.fn(), onSaved = vi.fn()
  const saved = { connections: [{ ...connection, has_api_key: false, api_key_hint: null }] }
  const request = vi.fn().mockResolvedValueOnce(settings).mockResolvedValueOnce(saved).mockResolvedValueOnce(saved)
  render(<LanguageProvider><ConnectionForm request={request} onDirtyChange={onDirtyChange} onSaved={onSaved} /></LanguageProvider>)
  fireEvent.click(await screen.findByLabelText('清除已保存密钥'))
  expect(screen.getByLabelText('API 密钥')).toBeDisabled()
  expect(onDirtyChange).toHaveBeenLastCalledWith(true)
  fireEvent.click(screen.getByRole('button', { name: '保存修改' }))
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
  expect(JSON.parse(request.mock.calls[1][1].body).connection.api_key).toBeNull()
  expect(onDirtyChange).toHaveBeenLastCalledWith(false)
  expect(screen.queryByLabelText('清除已保存密钥')).not.toBeInTheDocument()
})

it('keeps non-OpenAI adapters as generic connections without translation controls', async () => {
  const request = vi.fn().mockResolvedValue({ connections: [{ adapter: 'custom', base_url: 'https://custom.test', has_api_key: false }] })
  render(<LanguageProvider><ConnectionForm request={request} adapter="custom" title="Custom service" /></LanguageProvider>)
  expect(await screen.findByRole('heading', { name: 'Custom service' })).toBeInTheDocument()
  expect(screen.queryByLabelText('模型名称')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '测试连接' })).not.toBeInTheDocument()
  expect(screen.getByLabelText('API 密钥')).not.toBeRequired()
})
