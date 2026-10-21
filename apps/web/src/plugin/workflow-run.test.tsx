import { Context } from 'cordis'
import type { ReactNode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { LanguageProvider } from '@/lib/i18n'
import { PluginContextProvider, requireActive, type NodeTypeDefinition, type WorkflowDocument } from './sdk'
import { WorkflowRun as WorkflowRunView } from './builtin/workflow-run'
import { WorkflowRerun as WorkflowRerunView } from './builtin/workflow-rerun'
import { WorkflowResources, type ResourceState } from './builtin/workflow-resources'
import { bindTestComponent } from './test-bindings'
import type { Bindings } from './sdk'
const WorkflowRun = bindTestComponent(WorkflowRunView, ['request', 'navigate', 'useSlot', 'useWorkflowResources'])
const WorkflowRerun = bindTestComponent(WorkflowRerunView, ['request', 'navigate', 'useQuery', 'useSlot', 'useWorkflowResources'])
import { HttpError } from './builtin/api'
import { WorkflowDiagnostics } from './builtin/workflow-errors'
import * as apiPlugin from './builtin/api'

const types: NodeTypeDefinition[] = [{
  type: 'test.transcribe', version: '1', providerId: 'test', operation: 'transcribe',
  label: { default: 'Transcribe', translations: { zh: '识别字幕', ja: '字幕認識' } }, category: 'audio',
  provider: { id: 'test', label: { default: 'Speech recognition', translations: { zh: '语音识别', ja: '音声認識' } }, operations: [] },
  inputs: [], outputs: [], configSchema: {}, defaults: {},
}, {
  type: 'test.export', version: '1', providerId: 'test', operation: 'export', label: '导出视频', category: 'media',
  provider: { id: 'test', operations: [] }, inputs: [], outputs: [], configSchema: {}, defaults: {},
}]
function graph(): WorkflowDocument {
  return {
    format: 'youdub.workflow', formatVersion: 1, id: 'graph', title: '字幕翻译',
    inputs: [{ id: 'source', label: '视频', kind: 'artifact', schemaId: 'video/mp4/v1', required: true, acceptedMimeTypes: ['video/*'], maxBytes: 10 }],
    nodes: [
      { id: 'node-9fa8', type: 'test.transcribe', typeVersion: '1', provider: { id: 'test' }, config: {}, autoContinue: true },
      { id: 'node-33ed', label: '成片导出', type: 'test.export', typeVersion: '1', provider: { id: 'test' }, config: {}, autoContinue: true },
    ], edges: [], outputs: [], presentation: { positions: {}, viewport: { x: 0, y: 0, zoom: 1 } },
  }
}
const ready: ResourceState = { status: 'ready', requirements: [{ providerId: 'test', ready: true, automatic: true }] }
const missing: ResourceState = { status: 'missing', requirements: [{ providerId: 'test', model: 'tiny', ready: false, automatic: true, reason: '模型文件尚未安装。' }] }
const base = '/api/v2/workflow-documents/resources/'
afterEach(() => { cleanup(); window.localStorage.clear(); vi.useRealTimers(); vi.unstubAllGlobals() })

it('rejects an unsupported dropped file with a visible error', async () => {
  mount(<WorkflowRun document={graph()} types={types} />, vi.fn(async () => ready))
  await screen.findByText('资源已就绪')
  const input = screen.getByLabelText('视频 *')
  fireEvent.drop(input.parentElement!, { dataTransfer: { files: [new File(['no'], 'notes.txt', { type: 'text/plain' })] } })
  expect(screen.getByText('notes.txt 的文件类型不支持。')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '开始运行' })).toBeDisabled()
})

it('keeps the original link-above-upload layout and submits URL input through a download node', async () => {
  const withDownload: NodeTypeDefinition[] = [...types, { type: 'youdub.download', version: '1', providerId: 'media', operation: 'download', provider: { id: 'media', operations: [] }, label: '下载', category: 'input', inputs: [], outputs: [{ name: 'video', kind: 'artifact', schemaId: 'video/mp4/v1', required: true }], configSchema: {}, defaults: {} }]
  const request = vi.fn(async (path: string, init?: RequestInit) => {
    if (path.includes('/validate')) return { valid: true, diagnostics: [] }
    if (path === '/api/v2/tasks' && init?.method === 'POST') return { id: 'created' }
    return ready
  })
  const { push } = mount(<WorkflowRun prominent document={graph()} types={withDownload} />, request)
  const user = userEvent.setup()
  const link = screen.getByLabelText('视频链接'), upload = screen.getByLabelText('视频 *')
  expect(link.compareDocumentPosition(upload) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(screen.getByText('或上传本地视频')).toBeInTheDocument()
  expect(link).toHaveClass('h-12')
  expect(upload.parentElement).toHaveClass('min-h-[132px]', 'py-6')
  await user.upload(upload, new File(['local'], 'local.mp4', { type: 'video/mp4' }))
  fireEvent.change(link, { target: { value: 'https://youtu.be/abcdefghijk' } })
  expect(screen.queryByText('local.mp4')).not.toBeInTheDocument()
  await waitFor(() => expect(screen.getByRole('button', { name: '下载并处理' })).toBeEnabled())
  await user.click(screen.getByRole('button', { name: '下载并处理' }))
  await waitFor(() => expect(push).toHaveBeenCalledWith('/tasks/created'))
  const body = request.mock.calls.find(([path]) => path === '/api/v2/tasks')![1]!.body as FormData
  const submitted = JSON.parse(String(body.get('request')))
  expect(body.has('input.source')).toBe(false)
  expect(submitted.graphDocument.inputs).toEqual([])
  expect(submitted.graphDocument.nodes[0].type).toBe('youdub.download')
  expect(submitted.nodeRuntimeInputs['source-download'].url).toBe('https://www.youtube.com/watch?v=abcdefghijk')
  expect(submitted.config).toEqual({})
  expect(JSON.stringify(submitted.graphDocument)).not.toContain('youtube.com')
})
function mount(child: ReactNode, request: ReturnType<typeof vi.fn>) {
  const push = vi.fn()
  const context = { apiClient: { request }, navigation: { push }, slots: { subscribe: () => () => {}, getSnapshot: () => 0, list: () => [] } } as unknown as Context
  const wrap = (child: ReactNode) => <PluginContextProvider context={context}><LanguageProvider>{child}</LanguageProvider></PluginContextProvider>
  const result = render(wrap(child))
  return { ...result, push, rerender: (child: ReactNode) => result.rerender(wrap(child)) }
}
function ResourceView({ document = graph(), useWorkflowResources }: { document?: WorkflowDocument } & Bindings<'useWorkflowResources'>) {
  const resources = useWorkflowResources(document)
  return <><WorkflowResources resources={resources} types={types} /><button disabled={!resources.ready}>继续</button></>
}
const Resources = bindTestComponent(ResourceView, ['useWorkflowResources'])
it('shows connection configuration separately from language support and blocks starting', async () => {
  const request = vi.fn(async () => ({ status: 'missing', requirements: [{ providerId: 'test', ready: false, automatic: false, configurationRequired: true, reason: 'Provider connection is not configured.' }] }))
  const { push } = mount(<Resources />, request)
  await screen.findByText('请配置所需服务')
  expect(screen.getByText('请配置服务地址、API Key 和模型。')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '继续' })).toBeDisabled()
  expect(screen.queryByRole('button', { name: '下载所需资源' })).not.toBeInTheDocument()
  await userEvent.setup().click(screen.getByRole('link', { name: '配置服务连接' }))
  expect(push).toHaveBeenCalledWith('/settings')
})
it('checks automatically and leaves only the ready state when no download is needed', async () => {
  const request = vi.fn<(path: string, init?: RequestInit) => Promise<ResourceState>>(async () => ready)
  mount(<Resources />, request)
  await screen.findByText('资源已就绪')
  expect(screen.getByRole('button', { name: '继续' })).toBeEnabled()
  expect(screen.queryByRole('button', { name: /检查|准备|下载|刷新/ })).not.toBeInTheDocument()
  expect(request).toHaveBeenCalledTimes(1)
  expect(request.mock.calls[0][0]).toBe(`${base}check`)
})
it('downloads only on request, shows progress and automatically finishes preparation', async () => {
  let prepared = false
  const request = vi.fn(async (path: string) => {
    if (path === `${base}prepare`) { prepared = true; return { ...missing, status: 'preparing', environment: [{ id: 'python', name: 'Python', status: 'ready' }], models: [{ id: 'tiny', name: 'Whisper tiny', status: 'downloading', total: 2048, received: 1024, speed: 512 }] } }
    return prepared ? ready : missing
  })
  mount(<Resources />, request)
  await screen.findByRole('button', { name: '下载所需资源' })
  expect(screen.getByText('语音识别 · tiny')).toBeInTheDocument()
  expect(request.mock.calls.map(([path]) => path)).toEqual([`${base}check`])
  await userEvent.setup().click(screen.getByRole('button', { name: '下载所需资源' }))
  await screen.findByText('Whisper tiny · 下载中')
  expect(screen.getByText('1.0 KB / 2.0 KB · 512 B/s')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '继续' })).toBeDisabled()
  await screen.findByText('资源已就绪', {}, { timeout: 3000 })
  expect(screen.getByRole('button', { name: '继续' })).toBeEnabled()
  expect(screen.queryByRole('button', { name: /检查|准备|下载|刷新/ })).not.toBeInTheDocument()
})
it('updates a different active preparation without requiring a refresh or leaving an empty warning', async () => {
  const request = vi.fn().mockResolvedValueOnce({ ...missing, activePreparation: { status: 'preparing' } }).mockResolvedValue({ ...ready, activePreparation: { status: 'ready' } })
  mount(<Resources />, request)
  await screen.findByText('另一工作流正在准备资源，完成后将自动更新状态。')
  expect(screen.queryByRole('button', { name: '下载所需资源' })).not.toBeInTheDocument()
  await screen.findByText('资源已就绪', {}, { timeout: 3000 })
  expect(screen.queryByText('另一工作流正在准备资源，完成后将自动更新状态。')).not.toBeInTheDocument()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(screen.getAllByRole('status')).toHaveLength(1)
})
it('preserves a check error, stops polling and retries only when requested', async () => {
  vi.useFakeTimers()
  const request = vi.fn().mockRejectedValueOnce(new Error('Connection reset by peer')).mockResolvedValue(ready)
  mount(<Resources />, request)
  await act(async () => {})
  expect(screen.getByRole('alert')).toHaveTextContent('Connection reset by peer')
  await act(async () => { await vi.advanceTimersByTimeAsync(10000) })
  expect(request).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('button', { name: '继续' })).toBeDisabled()
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '重新检查' })) })
  expect(request).toHaveBeenCalledTimes(2)
  expect(screen.getByText('资源已就绪')).toBeInTheDocument()
})
it('keeps the original preparation error and exposes a deliberate retry', async () => {
  const request = vi.fn().mockResolvedValueOnce({ ...missing, status: 'failed', error: 'TLS certificate verify failed' }).mockResolvedValue(ready)
  mount(<Resources />, request)
  expect(await screen.findByRole('alert')).toHaveTextContent('TLS certificate verify failed')
  expect(request).toHaveBeenCalledTimes(1)
  await userEvent.setup().click(screen.getByRole('button', { name: '重试准备' }))
  await screen.findByText('资源已就绪')
  expect(request.mock.calls[1][0]).toBe(`${base}prepare`)
})
it('does not offer automatic downloads for a manual plugin requirement', async () => {
  const request = vi.fn(async () => ({ ...missing, requirements: [{ providerId: 'test', ready: false, automatic: false, reason: '请配置插件的远程服务。' }] }))
  mount(<Resources />, request)
  await screen.findByText('请配置插件的远程服务。')
  expect(screen.getByText('语音识别')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '重新检查' })).toBeEnabled()
  expect(screen.queryByRole('button', { name: '下载所需资源' })).not.toBeInTheDocument()
})
it.each([
  ['en', 'Whisper tiny · Downloading'], ['ja', 'Whisper tiny · ダウンロード中'],
])('localizes preparation states in %s', async (language, expected) => {
  window.localStorage.setItem('youdub-ui-language', language)
  const request = vi.fn(async () => ({ ...missing, status: 'preparing', models: [{ id: 'tiny', name: 'Whisper tiny', status: 'downloading' }] }))
  mount(<Resources />, request)
  await screen.findByText(expected)
})
it('rechecks a changed model and ignores the old ready result during the check', async () => {
  let resolve!: (state: ResourceState) => void
  const request = vi.fn().mockResolvedValueOnce(ready).mockImplementationOnce(() => new Promise<ResourceState>((done) => { resolve = done }))
  const document = graph(), view = mount(<Resources document={document} />, request)
  await screen.findByText('资源已就绪')
  const changed = structuredClone(document); changed.nodes[0].provider.model = 'large'
  view.rerender(<Resources document={changed} />)
  expect(screen.getByRole('button', { name: '继续' })).toBeDisabled()
  expect(screen.queryByText('资源已就绪')).not.toBeInTheDocument()
  await act(async () => { resolve(missing) })
  await screen.findByRole('button', { name: '下载所需资源' })
  expect(request.mock.calls[1][0]).toBe(`${base}check`)
  expect(JSON.parse(request.mock.calls[1][1].body).document.nodes[0].provider.model).toBe('large')
})
it('clears a previous file when its replacement exceeds the limit and submits only the next valid file', async () => {
  const request = vi.fn<(path: string, init?: RequestInit) => Promise<unknown>>(async (path) => path.startsWith(base) ? ready : path.endsWith('/validate') ? { valid: true, diagnostics: [] } : { id: 'created' })
  const view = mount(<WorkflowRun document={graph()} types={types} />, request)
  const user = userEvent.setup(), input = screen.getByLabelText('视频 *')
  await screen.findByText('资源已就绪')
  await user.upload(input, new File(['first'], 'first.mp4', { type: 'video/mp4' }))
  expect(screen.getByRole('button', { name: '开始运行' })).toBeEnabled()
  await user.upload(input, new File(['too many bytes'], 'large.mp4', { type: 'video/mp4' }))
  expect(screen.getByRole('alert')).toHaveTextContent('large.mp4 超过大小上限 10 B。')
  expect(input).toHaveValue('')
  expect(screen.getByRole('button', { name: '开始运行' })).toBeDisabled()
  await user.upload(input, new File(['third'], 'third.mp4', { type: 'video/mp4' }))
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '开始运行' }))
  await waitFor(() => expect(view.push).toHaveBeenCalledWith('/tasks/created'))
  const submitted = request.mock.calls.find(([path]) => path === '/api/v2/tasks')![1]!.body as FormData
  expect((submitted.get('input.source') as File).name).toBe('third.mp4')
})
it('keeps parent and file editing locked after an uncertain submission until cleanup succeeds', async () => {
  const onLockChange = vi.fn()
  let cleanupFails = true
  const request = vi.fn(async (path: string, init?: RequestInit) => {
    if (path.startsWith(base)) return ready
    if (path.endsWith('/validate')) return { valid: true, diagnostics: [] }
    if (init?.method === 'DELETE') { if (cleanupFails) throw new Error('Import is still busy'); return undefined }
    throw new Error('Connection interrupted')
  })
  const view = mount(<WorkflowRun document={graph()} types={types} onLockChange={onLockChange} />, request)
  const user = userEvent.setup(), input = screen.getByLabelText('视频 *')
  await screen.findByText('资源已就绪')
  expect(onLockChange).toHaveBeenLastCalledWith(false)
  await user.upload(input, new File(['file'], 'video.mp4', { type: 'video/mp4' }))
  await user.click(screen.getByRole('button', { name: '开始运行' }))
  await screen.findByText('Connection interrupted')
  expect(onLockChange).toHaveBeenLastCalledWith(true)
  expect(input).toBeDisabled()
  expect(screen.queryByRole('link', { name: '连接设置' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '放弃本次提交并修改' }))
  await screen.findByText('Import is still busy')
  expect(onLockChange).toHaveBeenLastCalledWith(true)
  cleanupFails = false
  await user.click(screen.getByRole('button', { name: '放弃本次提交并修改' }))
  await waitFor(() => expect(input).toBeEnabled())
  expect(onLockChange).toHaveBeenLastCalledWith(false)
  const count = onLockChange.mock.calls.length
  view.unmount()
  expect(onLockChange).toHaveBeenCalledTimes(count)
})
it('prepares dependencies before rerunning, names kept/recomputed nodes and preserves failure diagnostics', async () => {
  const document = graph(), onLockChange = vi.fn()
  let prepared = false
  const preview = { reusedSteps: ['node-9fa8'], dirtySteps: ['node-33ed'], expectedAttempt: 1, expectedTaskRevision: 2, sourceRevisions: { 'node-9fa8': 1 } }
  const request = vi.fn(async (path: string, init?: RequestInit) => {
    if (path === `${base}prepare`) { prepared = true; return ready }
    if (path === `${base}check`) return prepared ? ready : missing
    if (path === '/api/v2/tasks/source') return { id: 'source', status: 'succeeded', attempt: 1, revision: 2, steps: [] }
    if (path.endsWith('/rerun-preview')) return preview
    if (path.endsWith('/rerun')) throw new HttpError('Workflow validation failed.', 422, 'INVALID_GRAPH', [{ code: 'INVALID_GRAPH', nodeId: 'node-33ed', message: 'Export requires a video input.' }])
    if (init?.method === 'DELETE') return undefined
    throw new Error(path)
  })
  mount(<WorkflowRerun taskId="source" document={document} types={types} onStarted={vi.fn()} onLockChange={onLockChange} />, request)
  const user = userEvent.setup()
  await screen.findByRole('button', { name: '下载所需资源' })
  expect(screen.getByRole('button', { name: '检查重跑范围' })).toBeDisabled()
  expect(screen.queryByLabelText('视频 *')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '下载所需资源' }))
  await screen.findByText('资源已就绪')
  await user.click(screen.getByRole('button', { name: '检查重跑范围' }))
  await screen.findByText('保留结果: 识别字幕')
  expect(screen.getByText('重新处理: 成片导出')).toBeInTheDocument()
  expect(screen.queryByText(/node-9fa8|node-33ed/)).not.toBeInTheDocument()
  expect(screen.getByText('沿用原素材创建新任务。')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '检查重跑范围' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '重新运行' }))
  await screen.findByText('成片导出: Export requires a video input.')
  expect(onLockChange).toHaveBeenLastCalledWith(true)
  expect(screen.getByRole('button', { name: '重新运行' })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: '放弃本次提交并修改' }))
  await waitFor(() => expect(onLockChange).toHaveBeenLastCalledWith(false))
  expect(screen.getByRole('button', { name: '检查重跑范围' })).toBeEnabled()
})
it('preserves backend diagnostics in the API error instead of only the generic message', async () => {
  const details = [{ code: 'INVALID_GRAPH', nodeId: 'node-33ed', message: 'Required input is missing.' }]
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: { code: 'INVALID_GRAPH', message: 'Workflow validation failed.', details } }, { status: 422 })))
  const root = new Context(), fiber = root.plugin(apiPlugin)
  await requireActive(fiber, 'api')
  try {
    await expect(root.apiClient.request('/api/v2/tasks/source/rerun-preview', { method: 'POST', body: '{}' })).rejects.toMatchObject({ status: 422, code: 'INVALID_GRAPH', details })
  } finally { await fiber.dispose() }
})

it('keeps the resource request stable through Cordis service proxies and unrelated graph edits', async () => {
  const fetch = vi.fn(async () => Response.json(ready))
  vi.stubGlobal('fetch', fetch)
  const root = new Context(), fiber = root.plugin(apiPlugin)
  await requireActive(fiber, 'api')
  try {
    expect(root.apiClient).not.toBe(root.apiClient)
    const document = graph()
    const wrap = (document: WorkflowDocument) => <PluginContextProvider context={root}><LanguageProvider><Resources document={document} /></LanguageProvider></PluginContextProvider>
    const view = render(wrap(document))
    await screen.findByText('资源已就绪')
    const renamed = structuredClone(document); renamed.title = '已改名'; renamed.presentation.viewport.zoom = 1.5
    view.rerender(wrap(renamed))
    await act(async () => {})
    expect(fetch).toHaveBeenCalledTimes(1)
    view.unmount()
  } finally { await fiber.dispose() }
})

it('unlocks after validation fails before upload and identifies the affected node', async () => {
  const onLockChange = vi.fn()
  const request = vi.fn(async (path: string) => path.startsWith(base) ? ready : { valid: false, diagnostics: [{ code: 'INVALID_GRAPH', nodeId: 'node-9fa8', message: 'Select a model.' }] })
  mount(<WorkflowRun document={graph()} types={types} onLockChange={onLockChange} />, request)
  await screen.findByText('资源已就绪')
  const user = userEvent.setup(), input = screen.getByLabelText('视频 *')
  await user.upload(input, new File(['file'], 'video.mp4', { type: 'video/mp4' }))
  await user.click(screen.getByRole('button', { name: '开始运行' }))
  await screen.findByText('识别字幕: Select a model.')
  expect(onLockChange).toHaveBeenLastCalledWith(false)
  expect(input).toBeEnabled()
  expect(request.mock.calls.some(([path]) => path === '/api/v2/tasks')).toBe(false)
  expect(screen.queryByRole('button', { name: '查询创建结果' })).not.toBeInTheDocument()
})

it('keeps missing resources compact while retaining expandable diagnostics and preparation logs', async () => {
  const request = vi.fn(async () => ({ ...missing,
    models: [{ id: 'tiny', name: 'Whisper tiny', status: 'pending', total: 2048, received: 0 }],
    environment: [{ id: 'python', name: 'Python', status: 'ready', detail: '/runtime/python -m pip install ...' }],
  }))
  mount(<Resources />, request)
  await screen.findByRole('button', { name: '下载所需资源' })
  expect(screen.queryByText('Whisper tiny · 等待中')).not.toBeInTheDocument()
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  expect(screen.getByText('模型文件尚未安装。').closest('details')).not.toHaveAttribute('open')
  expect(screen.getByText('/runtime/python -m pip install ...').closest('details')).not.toHaveAttribute('open')
})

it('leads with node names and actions for configuration errors while keeping original diagnostics', async () => {
  const onSelect = vi.fn(), document = graph()
  const diagnostics = [
    { code: 'PROVIDER_UNAVAILABLE', nodeId: 'node-9fa8', message: 'Provider connection is not configured.' },
    { code: 'INVALID_GRAPH', nodeId: 'node-33ed', message: 'Select a model and device.' },
  ]
  mount(<WorkflowDiagnostics diagnostics={diagnostics} document={document} types={types} onSelect={onSelect} />, vi.fn())
  expect(screen.getByText('识别字幕: 请在设置中填写服务地址和 API Key。')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: '配置服务连接' })).toHaveAttribute('href', '/settings')
  expect(screen.getByText('成片导出: 请为此节点选择模型和运行设备。')).toBeInTheDocument()
  expect(screen.getByText('Select a model and device.').closest('details')).not.toHaveAttribute('open')
  expect(screen.getByText('Provider connection is not configured.').closest('details')).not.toHaveAttribute('open')
  await userEvent.setup().click(screen.getByRole('button', { name: '打开节点设置' }))
  expect(onSelect).toHaveBeenCalledWith(diagnostics[1])
})
