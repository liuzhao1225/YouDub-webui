import { useState } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { LanguageProvider } from '@/test/language-provider'
import { NodeSettings } from './builtin/workflow-settings'
import type { Bindings, NodeTypeDefinition, WorkflowDocument } from './sdk'

const definition: NodeTypeDefinition = {
  type: 'test.separate', version: '1', providerId: 'demucs', operation: 'separate', label: '分离人声', category: 'audio',
  inputs: [], outputs: [], configSchema: { type: 'object' }, defaults: {},
  provider: { id: 'demucs', label: 'Demucs', operations: [], execution: 'local', models: [
    { id: 'htdemucs', devices: ['cpu', 'cuda:0'] }, { id: 'other', devices: ['cpu'] },
  ] },
}
const useSlot = (() => []) as Bindings<'useSlot'>['useSlot']
function mount(device = 'auto') {
  const changed = vi.fn()
  function View() {
    const [document, setDocument] = useState<WorkflowDocument>({
      format: 'youdub.workflow', formatVersion: 1, id: 'test', title: 'test', inputs: [], outputs: [], edges: [],
      nodes: [{ id: 'separate', type: definition.type, typeVersion: definition.version, provider: { id: definition.providerId, model: 'htdemucs', device }, config: {}, autoContinue: true }],
      presentation: { positions: {}, viewport: { x: 0, y: 0, zoom: 1 } },
    })
    return <NodeSettings readOnly={false} document={document} node={document.nodes[0]} types={[definition]} useSlot={useSlot} onChange={next => { changed(next); setDocument(next) }} />
  }
  render(<LanguageProvider><View /></LanguageProvider>)
  return changed
}
afterEach(() => { cleanup(); window.localStorage.clear() })

it('offers automatic GPU selection, preserves manual CPU, and allows switching back', async () => {
  const changed = mount(), user = userEvent.setup()
  expect(screen.getByLabelText('设备')).toHaveTextContent('自动（优先 GPU）')
  await user.click(screen.getByLabelText('设备'))
  await user.click(screen.getByRole('menuitem', { name: 'cpu' }))
  expect(changed.mock.calls.at(-1)![0].nodes[0].provider.device).toBe('cpu')
  await user.click(screen.getByLabelText('模型'))
  await user.click(screen.getByRole('menuitem', { name: 'other' }))
  expect(changed.mock.calls.at(-1)![0].nodes[0].provider.device).toBe('cpu')
  await user.click(screen.getByLabelText('设备'))
  await user.click(screen.getByRole('menuitem', { name: '自动（优先 GPU）' }))
  expect(changed.mock.calls.at(-1)![0].nodes[0].provider.device).toBe('auto')
})

it('keeps automatic selection when changing to a model that currently only supports CPU', async () => {
  const changed = mount(), user = userEvent.setup()
  await user.click(screen.getByLabelText('模型'))
  await user.click(screen.getByRole('menuitem', { name: 'other' }))
  expect(changed.mock.calls.at(-1)![0].nodes[0].provider.device).toBe('auto')
  expect(screen.getByLabelText('设备')).toHaveTextContent('自动（优先 GPU）')
})

it.each([['en', 'Device', 'Automatic (prefer GPU)'], ['ja', 'デバイス', '自動（GPU 優先）']])('localizes automatic devices in %s', async (language, label, value) => {
  window.localStorage.setItem('youdub-ui-language', language)
  mount()
  expect(await screen.findByLabelText(label)).toHaveTextContent(value)
})
