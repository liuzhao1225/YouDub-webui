import type { Context } from 'cordis'
import type { ComponentType } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { LanguageProvider } from '@/lib/i18n'
import { PluginContextProvider, type Catalog, type RouteProps, type SlotMap } from './sdk'
import { apply } from './builtin/studio'

const catalog: Catalog = { providers: [], workflows: [{ id: 'external.text', version: '2.0.0', label: 'Text workflow', inputs: [{ name: 'document', label: 'Document', acceptedMimeTypes: ['text/plain'], required: true }], configSchema: { type: 'object', properties: { mode: { type: 'string', enum: ['upper', 'lower'] } }, required: ['mode'] }, defaults: { mode: 'upper' } }] }
afterEach(() => { cleanup(); window.localStorage.clear() })

it('submits declared input slots and preserves an uncertain creation ID until explicitly cleared', async () => {
  const request = vi.fn(async (path: string, init?: RequestInit) => {
    if (path === '/api/v2/catalog') return catalog
    if (init?.method === 'DELETE') return undefined
    throw new Error('Connection interrupted')
  })
  let Page!: ComponentType<RouteProps>
  const context = {
    apiClient: { request }, navigation: { push: vi.fn() },
    slots: { register: (slot: string, entry: SlotMap['shell.routes']) => { if (slot === 'shell.routes') Page = entry.component; return () => {} }, subscribe: () => () => {}, getSnapshot: () => 0, list: () => [] },
    effect: (effect: () => unknown) => effect(),
  } as unknown as Context
  apply(context)
  render(<PluginContextProvider context={context}><LanguageProvider><Page params={{}} /></LanguageProvider></PluginContextProvider>)
  const input = await screen.findByLabelText('Document *')
  const user = userEvent.setup()
  await user.upload(input, new File(['hello'], 'input.txt', { type: 'text/plain' }))
  expect((input as HTMLInputElement).files).toHaveLength(1)
  expect(screen.getByRole('button', { name: '开始处理' })).toHaveAttribute('type', 'submit')
  // jsdom does not connect user-event's FileList to native file validity.
  fireEvent.submit(input.closest('form')!)
  await screen.findByText('Connection interrupted')
  const first = request.mock.calls.find(([, init]) => init?.method === 'POST')![1]!.body as FormData
  const firstRequest = JSON.parse(first.get('request') as string)
  expect(firstRequest).toMatchObject({ workflowId: 'external.text', workflowVersion: '2.0.0', config: { mode: 'upper' } })
  expect((first.get('input.document') as File).name).toBe('input.txt')
  expect(first.has('file')).toBe(false)
  expect(input).toBeDisabled()
  fireEvent.submit(input.closest('form')!)
  await waitFor(() => expect(request.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(2))
  const repeated = request.mock.calls.filter(([, init]) => init?.method === 'POST')[1][1]!.body as FormData
  expect(JSON.parse(repeated.get('request') as string).id).toBe(firstRequest.id)
  await user.click(screen.getByRole('button', { name: '清理本次导入' }))
  await waitFor(() => expect(input).toBeEnabled())
  expect(request).toHaveBeenCalledWith(`/api/v2/imports/${firstRequest.id}`, { method: 'DELETE' })
})
