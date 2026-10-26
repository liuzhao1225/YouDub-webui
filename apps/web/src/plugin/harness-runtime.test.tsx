import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { TestFeatureProvider, bindTestComponent, testHost, type TestContext } from './test-bindings'
import type { Bindings } from './sdk'

afterEach(cleanup)
it('refreshes mounted model choices and workflows on configuration changes without losing the working draft', async () => {
  let revision = 1, fail = false
  const request = vi.fn(async (path: string, init?: RequestInit) => {
    if (fail && init?.method === 'PATCH') throw new Error('Invalid model')
    return path.includes('workflow-documents') ? { items: [{ id: `workflow-${revision}` }], hasMore: false } : { id: `models-${revision}` }
  })
  const context = { apiClient: { request } } as unknown as TestContext
  function View({ useQuery, useWorkflowDocuments }: Bindings<'useQuery' | 'useWorkflowDocuments'>) {
    const models = useQuery<{ id: string }>('/api/v2/catalog')
    const workflows = useWorkflowDocuments()
    const [draft, setDraft] = useState('')
    return <><input aria-label="draft" value={draft} onChange={event => setDraft(event.target.value)} /><p>{models.data?.id}</p><p>{workflows.data?.items[0]?.id}</p></>
  }
  const Page = bindTestComponent(View, ['useQuery', 'useWorkflowDocuments'])
  const { unmount } = render(<TestFeatureProvider context={context}><Page /></TestFeatureProvider>)
  const host = testHost(context)
  await screen.findByText('models-1'); await screen.findByText('workflow-1')
  fireEvent.change(screen.getByLabelText('draft'), { target: { value: 'unsaved video link' } })
  const reads = request.mock.calls.length
  await act(() => host.value.request('/api/v2/resources/check', { method: 'POST' }))
  await act(() => host.value.request('/api/v2/tasks/task/log'))
  expect(request).toHaveBeenCalledTimes(reads + 2)
  revision = 2; fail = true
  await expect(host.value.request('/api/v2/settings', { method: 'PATCH' })).rejects.toThrow('Invalid model')
  expect(screen.getByText('models-1')).toBeInTheDocument()
  fail = false
  await act(() => host.value.request('/api/v2/settings', { method: 'PATCH' }))
  await screen.findByText('models-2'); await screen.findByText('workflow-2')
  revision = 3
  act(() => host.emit('llm/adapters-updated'))
  await screen.findByText('models-3'); await screen.findByText('workflow-3')
  expect(screen.getByLabelText('draft')).toHaveValue('unsaved video link')
  expect(host.listenerCount()).toBe(5)
  unmount(); host.dispose()
  expect(host.listenerCount()).toBe(0)
})


it('protects shared submissions while pending and after an uncertain response, until cleared or disposed', async () => {
  let reject!: (error: Error) => void
  const request = vi.fn(() => new Promise((_, fail) => { reject = fail }))
  const host = testHost({ apiClient: { request } } as TestContext)
  const canUnload = () => window.dispatchEvent(new Event('beforeunload', { cancelable: true }))
  expect(canUnload()).toBe(true)
  const pending = host.value.draftStore.submit('composer:test', host.value.request, JSON.stringify({ id: 'pending' }))
  expect(canUnload()).toBe(false)
  reject(new Error('Connection interrupted'))
  await pending
  expect(host.value.draftStore.getSnapshot().submissions['composer:test'].error).toBe('Connection interrupted')
  expect(canUnload()).toBe(false)
  host.value.draftStore.clearSubmission('composer:test')
  expect(canUnload()).toBe(true)
  host.dispose()
  expect(canUnload()).toBe(true)
})
