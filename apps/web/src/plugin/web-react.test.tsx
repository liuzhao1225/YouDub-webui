import { useState } from 'react'
import type { Context } from 'cordis'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { bindComponent, type Bindings } from './web-react'

afterEach(cleanup)
it('refreshes mounted model choices and workflows on configuration changes without losing the working draft', async () => {
  const listeners = new Set<(path: string, method: string) => void>()
  let revision = 1
  const request = vi.fn(async (path: string) => path.includes('workflow-documents') ? { items: [{ id: `workflow-${revision}` }], hasMore: false } : { id: `models-${revision}` })
  const context = { apiClient: { request }, on: (_event: string, handler: (path: string, method: string) => void) => { listeners.add(handler); return () => listeners.delete(handler) } } as unknown as Context
  function View({ useQuery, useWorkflowDocuments }: Bindings<'useQuery' | 'useWorkflowDocuments'>) {
    const models = useQuery<{ id: string }>('/api/v2/catalog')
    const workflows = useWorkflowDocuments()
    const [draft, setDraft] = useState('')
    return <><input aria-label="draft" value={draft} onChange={event => setDraft(event.target.value)} /><p>{models.data?.id}</p><p>{workflows.data?.items[0]?.id}</p></>
  }
  const Page = bindComponent(context, ['useQuery', 'useWorkflowDocuments'], View)
  const { unmount } = render(<Page />)
  await screen.findByText('models-1'); await screen.findByText('workflow-1')
  fireEvent.change(screen.getByLabelText('draft'), { target: { value: 'unsaved video link' } })
  const reads = request.mock.calls.length
  act(() => listeners.forEach(listener => listener('/api/v2/models/discover', 'POST')))
  act(() => listeners.forEach(listener => listener('/api/v2/models/credentials/describe', 'POST')))
  expect(request).toHaveBeenCalledTimes(reads)
  revision = 2
  act(() => listeners.forEach(listener => listener('/api/v2/models/settings', 'PATCH')))
  await screen.findByText('models-2'); await screen.findByText('workflow-2')
  expect(screen.getByLabelText('draft')).toHaveValue('unsaved video link')
  unmount()
  await waitFor(() => expect(listeners.size).toBe(0))
})
