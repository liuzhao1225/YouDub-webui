import type { Context } from 'cordis'
import type { ComponentType } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { LanguageProvider } from '@/lib/i18n'
import { PluginContextProvider, type Catalog, type NodeTypeDefinition, type RouteProps, type SlotMap, type TaskView, type WorkflowDocument } from './sdk'
import { apply } from './builtin/studio'
import reviewedSubtitles from '../../../../packages/builtin/src/workflow-templates/reviewed-subtitles.json'
import { nodeDescriptors } from '../../../../packages/builtin/src/node-contracts'

const catalog: Catalog = { providers: [], workflows: [{ id: 'external.text', version: '2.0.0', label: 'Text workflow', inputs: [{ name: 'document', label: 'Document', acceptedMimeTypes: ['text/plain'], required: true }], configSchema: { type: 'object', properties: { mode: { type: 'string', enum: ['upper', 'lower'] } }, required: ['mode'] }, defaults: { mode: 'upper' } }] }
afterEach(() => { cleanup(); window.localStorage.clear() })

it('keeps dropped media across workflows and edits only each node’s declared basic settings for this run', async () => {
  const template = structuredClone(reviewedSubtitles) as WorkflowDocument
  template.nodes = [
    { ...template.nodes[1], label: '第一段识别', config: { sourceLanguage: 'auto', initialPrompt: 'preserved' } },
    { ...template.nodes[1], id: 'recognize-second', label: '第二段识别', config: { sourceLanguage: 'en', initialPrompt: 'second' } },
  ]
  const another = { ...structuredClone(template), id: 'another', title: '另一个工作流', inputs: [{ ...template.inputs[0], id: 'renamed-video' }] }
  const definitions: NodeTypeDefinition[] = [{ type: 'youdub.transcribe', version: '1.0.0', providerId: 'whisper', operation: 'transcribe', provider: { id: 'whisper', operations: [] }, label: '识别', category: 'text', inputs: [], outputs: [], defaults: {}, configSchema: { type: 'object', properties: { sourceLanguage: { type: 'string', enum: ['auto', 'en', 'ja'], 'x-title': '原文语言' }, initialPrompt: { type: 'string', 'x-title': '识别提示词' } } }, ui: { quickFields: ['sourceLanguage'] } }]
  const request = vi.fn(async (path: string, init?: RequestInit) => {
    if (path === '/api/v2/catalog') return { providers: [], workflows: [{ ...catalog.workflows[0], id: 'youdub.graph' }, { ...catalog.workflows[0], id: 'youdub.localize', label: '旧视频流程' }, { ...catalog.workflows[0], id: 'external.graph', label: template.title, graphTemplate: template }, catalog.workflows[0]] }
    if (path.startsWith('/api/v2/workflow-documents?')) return { items: [template, another].map((document) => ({ id: document.id, revision: 1, origin: 'builtin', document })) }
    if (path === '/api/v2/node-types') return { items: definitions }
    if (path.includes('/resources/check')) return { status: 'ready', requirements: [] }
    if (path.includes('/validate')) return { valid: true, diagnostics: [] }
    if (path.startsWith('/api/v2/tasks?')) return { items: [] }
    if (path === '/api/v2/tasks' && init?.method === 'POST') throw new Error('Connection interrupted')
    throw new Error(`Unexpected request ${path}`)
  })
  mount(request)
  await screen.findByText('拖入视频，或点击选择文件')
  expect(screen.getByRole('heading', { name: '让视频说另一种语言' })).toBeInTheDocument()
  expect(screen.queryByText('处理流程')).not.toBeInTheDocument()
  expect(screen.queryByText('其他处理方式')).not.toBeInTheDocument()
  const user = userEvent.setup()
  await user.click(screen.getByLabelText('工作流'))
  expect(screen.queryByRole('option', { name: '旧视频流程' })).not.toBeInTheDocument()
  expect(await screen.findByRole('option', { name: 'Text workflow' })).toBeInTheDocument()
  expect(screen.getAllByRole('option', { name: template.title })).toHaveLength(1)
  await user.keyboard('{Escape}')
  expect(screen.queryByLabelText('识别提示词')).not.toBeInTheDocument()
  const input = screen.getByLabelText('视频 *')
  fireEvent.drop(input.parentElement!, { dataTransfer: { files: [new File(['video'], 'dropped.mp4', { type: 'video/mp4' })] } })
  await user.click(screen.getByLabelText('第一段识别 · 原文语言'))
  await user.click(await screen.findByRole('option', { name: 'ja' }))
  expect(screen.getByLabelText('第二段识别 · 原文语言')).toHaveTextContent('en')
  await user.click(screen.getByLabelText('工作流'))
  await user.click(await screen.findByRole('option', { name: '另一个工作流' }))
  expect(screen.getByText('dropped.mp4')).toBeInTheDocument()
  await user.click(screen.getByLabelText('工作流'))
  await user.click(await screen.findByRole('option', { name: template.title }))
  expect(screen.getByLabelText('第一段识别 · 原文语言')).toHaveTextContent('ja')
  expect(template.nodes[0].config.sourceLanguage).toBe('auto')
  await waitFor(() => expect(screen.getByRole('button', { name: '开始处理' })).toBeEnabled())
  await user.click(screen.getByRole('button', { name: '开始处理' }))
  await screen.findByText('Connection interrupted')
  const body = request.mock.calls.find(([path, init]) => path === '/api/v2/tasks' && init?.method === 'POST')![1]!.body as FormData
  const submitted = JSON.parse(String(body.get('request')))
  expect(submitted).toMatchObject({ workflowId: 'youdub.graph', documentRevision: null })
  expect(submitted.graphDocument.nodes[0].config).toEqual({ sourceLanguage: 'ja', initialPrompt: 'preserved' })
  expect(submitted.graphDocument.nodes[1].config.sourceLanguage).toBe('en')
  expect(submitted.graphDocument.nodes[0].autoContinue).toBe(false)
  expect((body.get('input.video') as File).name).toBe('dropped.mp4')
  expect(screen.getByLabelText('工作流')).toBeDisabled()
  expect(screen.getByLabelText('第一段识别 · 原文语言')).toBeDisabled()
})

it('submits declared input slots and preserves an uncertain creation ID until explicitly cleared', async () => {
  const request = vi.fn(async (path: string, init?: RequestInit) => {
    if (path === '/api/v2/catalog') return catalog
    if (path.startsWith('/api/v2/tasks?')) return { items: [], hasMore: false, limit: 12, offset: 0 }
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
  expect(screen.getByRole('link', { name: '查看内置示例' })).toHaveAttribute('href', '/examples/index.html')
  const user = userEvent.setup()
  await user.upload(input, new File(['hello'], 'input.txt', { type: 'text/plain' }))
  expect((input as HTMLInputElement).files).toHaveLength(1)
  expect(screen.queryByLabelText('处理流程')).not.toBeInTheDocument()
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

it('locks workflow selection while a submitted import still needs reconciliation', async () => {
  const multiple = { ...catalog, workflows: [...catalog.workflows, { ...catalog.workflows[0], id: 'another', label: 'Another workflow' }] }
  const request = vi.fn(async (path: string, init?: RequestInit) => {
    if (path === '/api/v2/catalog') return multiple
    if (path.startsWith('/api/v2/tasks?')) return { items: [], hasMore: false, limit: 12, offset: 0 }
    if (init?.method === 'DELETE') return undefined
    throw new Error('Connection interrupted')
  })
  let Page!: ComponentType<RouteProps>
  const context = { apiClient: { request }, navigation: { push: vi.fn() },
    slots: { register: (slot: string, entry: SlotMap['shell.routes']) => { if (slot === 'shell.routes') Page = entry.component; return () => {} }, subscribe: () => () => {}, getSnapshot: () => 0, list: () => [] }, effect: (effect: () => unknown) => effect(),
  } as unknown as Context
  apply(context)
  render(<PluginContextProvider context={context}><LanguageProvider><Page params={{}} /></LanguageProvider></PluginContextProvider>)
  const input = await screen.findByLabelText('Document *')
  const user = userEvent.setup()
  await user.upload(input, new File(['hello'], 'input.txt', { type: 'text/plain' }))
  fireEvent.submit(input.closest('form')!)
  await screen.findByText('Connection interrupted')
  expect(screen.getByLabelText('工作流')).toBeDisabled()
  await user.click(screen.getByRole('button', { name: '清理本次导入' }))
  await waitFor(() => expect(screen.getByLabelText('工作流')).toBeEnabled())
  await user.selectOptions(screen.getByLabelText('工作流'), 'another')
  expect(screen.getByLabelText('Document *')).toHaveValue('')
})

it('retains each external composer draft after visiting settings and clears only the submitted draft', async () => {
  const media = { ...catalog.workflows[0], id: 'external.media', label: 'Media workflow', ui: { sourceUrlInput: 'video' }, inputs: [
    ...catalog.workflows[0].inputs,
    { name: 'video', label: '视频', acceptedMimeTypes: ['video/*'], required: false },
  ] }
  const request = vi.fn(async (path: string, init?: RequestInit) => {
    if (path === '/api/v2/catalog') return { ...catalog, workflows: [...catalog.workflows, media] }
    if (path === '/api/v2/tasks' && init?.method === 'POST') return { id: 'created' }
    return { items: [], hasMore: false }
  })
  let Page!: ComponentType<RouteProps>
  const push = vi.fn()
  const context = { apiClient: { request }, navigation: { push },
    slots: { register: (slot: string, entry: SlotMap['shell.routes']) => { if (slot === 'shell.routes') Page = entry.component; return () => {} }, subscribe: () => () => {}, getSnapshot: () => 0, list: () => [] }, effect: (effect: () => unknown) => effect(),
  } as unknown as Context
  apply(context)
  const showStudio = () => render(<PluginContextProvider context={context}><LanguageProvider><Page params={{}} /></LanguageProvider></PluginContextProvider>)
  let view = showStudio()
  const user = userEvent.setup()
  await user.upload(await screen.findByLabelText('Document *'), new File(['text draft'], 'text.txt', { type: 'text/plain' }))
  await user.selectOptions(screen.getByLabelText('工作流'), media.id)
  const file = new File(['media notes'], 'notes.txt', { type: 'text/plain' })
  await user.upload(screen.getByLabelText('Document *'), file)
  await user.type(screen.getByLabelText('视频链接'), 'https://youtu.be/jNQXAC9IVRw')
  await user.selectOptions(screen.getByLabelText('mode *'), 'lower')

  view.unmount() // The settings route unmounts the studio, while its plugin remains active.
  view = showStudio()
  await screen.findByText('notes.txt')
  expect(screen.getByLabelText('工作流')).toHaveValue(media.id)
  expect(screen.getByLabelText('视频链接')).toHaveValue('https://youtu.be/jNQXAC9IVRw')
  expect(screen.getByLabelText('mode *')).toHaveValue('lower')
  fireEvent.submit(screen.getByLabelText('视频链接').closest('form')!)
  await waitFor(() => expect(push).toHaveBeenCalledWith('/tasks/created'))
  const body = request.mock.calls.find(([path, init]) => path === '/api/v2/tasks' && init?.method === 'POST')![1]!.body as FormData
  expect(body.get('input.document')).toBe(file)
  expect(JSON.parse(String(body.get('request')))).toMatchObject({ workflowId: media.id, config: { mode: 'lower', source_url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw' } })

  view.unmount()
  showStudio()
  await screen.findByLabelText('视频链接')
  expect(screen.queryByText('notes.txt')).not.toBeInTheDocument()
  expect(screen.getByLabelText('视频链接')).toHaveValue('')
  expect(screen.getByLabelText('mode *')).toHaveValue('upper')
  await user.selectOptions(screen.getByLabelText('工作流'), catalog.workflows[0].id)
  expect(screen.getByText('text.txt')).toBeInTheDocument()
})

function mount(request: ReturnType<typeof vi.fn>) {
  let Page!: ComponentType<RouteProps>
  const push = vi.fn()
  const context = { apiClient: { request }, navigation: { push },
    slots: { register: (slot: string, entry: SlotMap['shell.routes']) => { if (slot === 'shell.routes') Page = entry.component; return () => {} }, subscribe: () => () => {}, getSnapshot: () => 0, list: () => [] }, effect: (effect: () => unknown) => effect(),
  } as unknown as Context
  apply(context)
  render(<PluginContextProvider context={context}><LanguageProvider><Page params={{}} /></LanguageProvider></PluginContextProvider>)
  return push
}

it('counts review nodes even while their independent branch is running', async () => {
  const active: TaskView = { id: 'review', status: 'running', attempt: 1, sourceName: 'review.mp4', createdAt: '2026-10-09T01:00:00Z', workflowId: 'youdub.graph', workflowVersion: '1', config: {}, outputs: [], allowedActions: [], steps: [
    { id: 'translate', label: '翻译', status: 'awaiting_review', progress: 1 },
    { id: 'audio', label: '生成配音', status: 'running', progress: 0.5 },
  ] }
  mount(vi.fn(async (path: string) => path === '/api/v2/catalog' ? catalog : { items: [active], hasMore: false }))
  const review = await screen.findByRole('link', { name: '1 个节点待确认' })
  expect(review).toHaveAttribute('href', '/tasks/review/nodes/translate')
  expect(screen.getByRole('link', { name: '1 个任务正在处理' })).toBeInTheDocument()
  expect(screen.getByRole('progressbar', { name: '生成配音 进度' })).toHaveValue(0.5)
})

it('shows the selected file and clears it before allowing a fresh selection', async () => {
  mount(vi.fn(async (path: string) => path === '/api/v2/catalog' ? catalog : { items: [], hasMore: false, limit: 12, offset: 0 }))
  const user = userEvent.setup()
  const input = await screen.findByLabelText('Document *')
  expect(screen.getByRole('button', { name: '开始处理' })).toBeDisabled()
  await user.upload(input, new File(['hello'], 'first.txt', { type: 'text/plain' }))
  expect(screen.getByText('first.txt')).toBeInTheDocument()
  expect(screen.getByText(/5 B/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '开始处理' })).toBeEnabled()
  await user.click(screen.getByRole('button', { name: '移除 first.txt' }))
  expect(screen.queryByText('first.txt')).not.toBeInTheDocument()
  expect(input).toHaveValue('')
  expect(screen.getByRole('button', { name: '开始处理' })).toBeDisabled()
  await user.upload(input, new File(['again'], 'second.txt', { type: 'text/plain' }))
  expect(screen.getByText('second.txt')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '开始处理' })).toBeEnabled()
})

it('keeps active tasks separate from recent results and links to their detail pages', async () => {
  const task = (id: string, status: TaskView['status']): TaskView => ({
    id, status, attempt: 1, sourceName: `${id}.mp4`, createdAt: '2026-10-09T01:00:00Z',
    workflowId: 'external.text', workflowVersion: '2.0.0', config: {}, steps: [], outputs: [], allowedActions: [], cover: { url: `/cover/${id}.jpg` },
  })
  const items = [task('running', 'running'), task('completed', 'succeeded'), task('failed', 'failed'), task('cancelling', 'cancelling')]
  items[0].steps = [{ id: 'synthesize', label: '生成配音', status: 'running', progress: null }, { id: 'export', label: '导出', status: 'pending', progress: null }]
  const push = mount(vi.fn(async (path: string) => path === '/api/v2/catalog' ? catalog : { items, hasMore: false, limit: 12, offset: 0 }))
  const active = await screen.findByRole('region', { name: '进行中' })
  const recent = screen.getByRole('region', { name: '最近任务' })
  expect(active).toHaveTextContent('running.mp4')
  expect(active).toHaveTextContent('cancelling.mp4')
  expect(active).not.toHaveTextContent('completed.mp4')
  expect(active).toHaveTextContent('生成配音')
  expect(active).toHaveTextContent('已完成 0/2 步')
  expect(active.querySelector('img')).toHaveAttribute('src', '/cover/running.jpg')
  expect(active.querySelector('progress')).toBeNull()
  expect(recent).toHaveTextContent('completed.mp4')
  expect(recent).toHaveTextContent('failed.mp4')
  expect(recent).not.toHaveTextContent('running.mp4')
  expect(recent.querySelector('img')).toHaveAttribute('src', '/cover/completed.jpg')
  await userEvent.setup().click(screen.getByRole('link', { name: /completed.mp4/ }))
  expect(push).toHaveBeenCalledWith('/tasks/completed')
})

it('places the link first, switches between sources and submits a canonical URL without a file', async () => {
  const linked: Catalog = { providers: [], workflows: [{ ...catalog.workflows[0], ui: { sourceUrlInput: 'video' }, inputs: [{ name: 'video', label: '视频', acceptedMimeTypes: ['video/*'], required: false }], configSchema: { type: 'object', properties: { source_url: { type: 'string' }, source_proxy_port: nodeDescriptors.download.configSchema.properties!.proxyPort } }, defaults: {} }] }
  const request = vi.fn(async (path: string, init?: RequestInit) => {
    if (path === '/api/v2/catalog') return linked
    if (init?.method === 'POST') return { id: 'download' }
    return { items: [], hasMore: false, limit: 12, offset: 0 }
  })
  const push = mount(request)
  const user = userEvent.setup()
  const link = await screen.findByLabelText('视频链接')
  const file = screen.getByLabelText('视频') as HTMLInputElement
  expect(link.compareDocumentPosition(file) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(screen.getByRole('button', { name: '开始处理' })).toBeDisabled()
  await user.upload(file, new File(['video'], 'clip.mp4', { type: 'video/mp4' }))
  await user.type(link, 'https://youtu.be/jNQXAC9IVRw')
  expect(file.files).toHaveLength(0)
  expect(screen.queryByText('clip.mp4')).not.toBeInTheDocument()
  await user.upload(file, new File(['video'], 'clip.mp4', { type: 'video/mp4' }))
  expect(link).toHaveValue('')
  await user.type(link, 'http://127.0.0.1/secret')
  await user.tab()
  expect(screen.getByRole('button', { name: '开始处理' })).toBeDisabled()
  expect(screen.getByText('请输入 YouTube 或 B 站的单个视频链接。')).toBeInTheDocument()
  await user.clear(link)
  await user.type(link, 'https://youtu.be/jNQXAC9IVRw')
  const proxy = screen.getAllByRole('spinbutton', { name: '本机 HTTP 代理端口（0 为直连）' })[0]
  fireEvent.change(proxy, { target: { value: '7897' } })
  await user.click(screen.getByRole('button', { name: '下载并处理' }))
  await waitFor(() => expect(push).toHaveBeenCalledWith('/tasks/download'))
  const body = request.mock.calls.find(([, init]) => init?.method === 'POST')![1]!.body as FormData
  expect(JSON.parse(body.get('request') as string).config.source_url).toBe('https://www.youtube.com/watch?v=jNQXAC9IVRw')
  expect(JSON.parse(body.get('request') as string).config.source_proxy_port).toBe(7897)
  expect(body.has('input.video')).toBe(false)
})

it.each([null, {}, { adapter: 'openai', model: '', device: 'remote' }])('guides deferred translation setup and blocks submission for %j', async (translation) => {
  const localize: Catalog = { providers: [], workflows: [{
    ...catalog.workflows[0], id: 'youdub.localize', ui: { sourceUrlInput: 'video' },
    inputs: [{ name: 'video', label: '视频', acceptedMimeTypes: ['video/*'], required: false }],
    configSchema: { type: 'object', properties: {} }, defaults: { translation },
  }] }
  const request = vi.fn(async (path: string) => path === '/api/v2/catalog' ? localize : { items: [], hasMore: false })
  const push = mount(request)
  const link = await screen.findByLabelText('视频链接')
  await userEvent.setup().type(link, 'https://youtu.be/jNQXAC9IVRw')
  expect(screen.getByText('开始任务前，请配置翻译连接和模型。')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '下载并处理' })).toBeDisabled()
  // Guard native form submissions as well as clicks on the disabled button.
  fireEvent.submit(link.closest('form')!)
  expect(request.mock.calls.some(([path]) => path === '/api/v2/tasks')).toBe(false)
  await userEvent.setup().click(screen.getByRole('link', { name: '打开设置' }))
  expect(push).toHaveBeenCalledWith('/settings/models')
})

it.each(['deepseek-flash', 'deepseek-v4-pro', 'custom-model'])('submits a configured translation model unchanged: %s', async (model) => {
  const translation = { adapter: 'openai', model, device: 'remote' }
  const localize: Catalog = { providers: [], workflows: [{
    ...catalog.workflows[0], id: 'youdub.localize', inputs: [],
    configSchema: { type: 'object', properties: {} }, defaults: { translation },
  }] }
  const request = vi.fn(async (path: string, init?: RequestInit) => {
    if (path === '/api/v2/catalog') return localize
    if (init?.method === 'POST') return { id: 'translated' }
    return { items: [], hasMore: false }
  })
  const push = mount(request)
  await userEvent.setup().click(await screen.findByRole('button', { name: '开始处理' }))
  await waitFor(() => expect(push).toHaveBeenCalledWith('/tasks/translated'))
  const body = request.mock.calls.find(([, init]) => init?.method === 'POST')![1]!.body as FormData
  expect(JSON.parse(body.get('request') as string).config.translation).toEqual(translation)
  expect(screen.queryByRole('link', { name: '打开设置' })).not.toBeInTheDocument()
})


it('retains a submission across a route unmount and does not navigate from its late response', async () => {
  let finish!: (task: { id: string }) => void
  const request = vi.fn(async (path: string, init?: RequestInit) => {
    if (path === '/api/v2/catalog') return catalog
    if (path.startsWith('/api/v2/tasks?')) return { items: [] }
    if (path === '/api/v2/tasks' && init?.method === 'POST') return new Promise<{ id: string }>(resolve => { finish = resolve })
    throw new Error('Unexpected request ' + path)
  })
  let Page!: ComponentType<RouteProps>
  const push = vi.fn()
  const context = { apiClient: { request }, navigation: { push },
    slots: { register: (slot: string, entry: SlotMap['shell.routes']) => { if (slot === 'shell.routes') Page = entry.component; return () => {} }, subscribe: () => () => {}, getSnapshot: () => 0, list: () => [] }, effect: (effect: () => unknown) => effect(),
  } as unknown as Context
  apply(context)
  const show = () => render(<PluginContextProvider context={context}><LanguageProvider><Page params={{}} /></LanguageProvider></PluginContextProvider>)
  const first = show(), user = userEvent.setup()
  const input = await screen.findByLabelText('Document *')
  await user.upload(input, new File(['data'], 'pending.txt', { type: 'text/plain' }))
  fireEvent.submit(input.closest('form')!)
  await waitFor(() => expect(finish).toBeDefined())
  first.unmount()
  await act(async () => finish({ id: 'created-while-away' }))
  expect(push).not.toHaveBeenCalled()
  show()
  expect(await screen.findByText('pending.txt')).toBeInTheDocument()
  expect(screen.getByLabelText('Document *')).toBeDisabled()
  await user.click(screen.getByRole('button', { name: '查询创建结果' }))
  expect(push).toHaveBeenCalledWith('/tasks/created-while-away')
  expect(request.mock.calls.filter(([path, init]) => path === '/api/v2/tasks' && init?.method === 'POST')).toHaveLength(1)
})
