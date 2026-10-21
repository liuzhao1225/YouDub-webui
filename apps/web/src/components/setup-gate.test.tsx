import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { SetupGate } from './setup-gate'
import { SetupScreen, sizeLabel, type SetupState } from './setup-screen'
import { SetupDiagnostics } from './setup-diagnostics'
import modelManifest from '../../../../packages/builtin/src/setup-models.json'
import requirements from '../../../../backend/requirements/resources.json'

const state: SetupState = { phase: 'models', version: '0.0.6', platform: 'darwin', arch: 'arm64', token: 'setup-token', canRetry: true,
  environment: [{ id: 'python', name: 'Python 3.12', status: 'ready' }],
  models: [{ id: 'qwen', name: 'Qwen3 Aligner', variant: '0.6B', purpose: '字幕对齐', status: 'downloading', received: 50, total: 100, speed: 10 }],
}
const response = (value: unknown, status = 200) => ({ ok: status === 200, status, text: async () => JSON.stringify(value) })
const modelItems = Object.entries(requirements.providers).flatMap(([providerId, value]) => 'model' in value
  ? [{ providerId, model: value.model.id, downloadId: value.model.downloadId, label: providerId, automatic: true }] : [])
const modelChoices: SetupState = {
  ...state,
  models: modelManifest.map(model => ({ id: model.id, name: model.name, variant: model.variant, purpose: model.purpose, status: 'pending', received: 0, total: model.files.reduce((sum, file) => sum + file.size, 0), speed: 0 })),
  resourceSelection: { required: true, prepared: false, items: modelItems, selections: modelItems.map(({ providerId, model }) => ({ providerId, model })) },
}
describe('first-run setup', () => {
  it('lists every required source model and its actual size without an option to skip models', () => {
    const onAction = vi.fn(), onPrepare = vi.fn()
    const view = render(<SetupScreen state={modelChoices} onAction={onAction} onPrepare={onPrepare} />)
    for (const model of modelChoices.models) {
      expect(screen.getByTitle(`${model.name} ${model.variant}`.trim())).toBeVisible()
      expect(screen.getByText(model.purpose)).toBeVisible()
    }
    const total = modelChoices.models.reduce((sum, model) => sum + model.total, 0)
    expect(screen.getByRole('status', { name: '全部模型大小' })).toHaveTextContent(`4 个 · ${sizeLabel(total)}`)
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '准备全部模型' })).toBeEnabled()
    expect(onAction).not.toHaveBeenCalled()
    expect(onPrepare).not.toHaveBeenCalled()
    view.rerender(<SetupScreen state={{ ...modelChoices, models: modelChoices.models.map(model => ({ ...model })) }} onAction={onAction} onPrepare={onPrepare} />)
    expect(screen.getByRole('status', { name: '全部模型大小' })).toHaveTextContent(`4 个 · ${sizeLabel(total)}`)
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(onPrepare).not.toHaveBeenCalled()
    view.unmount()
  })
  it('requires all models after a prior Whisper-only setup and preserves the original progress controls', async () => {
    const selections = modelItems.map(({ providerId, model }) => ({ providerId, model }))
    const choiceState: SetupState = { ...modelChoices, models: modelChoices.models.map(model => model.id === 'whisper' ? { ...model, status: 'ready', received: model.total } : model), resourceSelection: { ...modelChoices.resourceSelection!, selections: [{ providerId: 'whisper', model: 'tiny' }] } }
    const downloading: SetupState = { ...choiceState, models: choiceState.models.map(model => model.status === 'ready' ? model : { ...model, status: 'downloading', received: 1024, speed: 512 }), resourceSelection: { ...choiceState.resourceSelection!, required: false } }
    const request = vi.fn().mockResolvedValueOnce(choiceState).mockResolvedValue(downloading)
    const view = render(<SetupGate request={request}><div>实际工作台</div></SetupGate>)
    expect(await screen.findByText('初始化所需模型')).toBeVisible()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.getByText('已下载')).toBeVisible()
    expect(request).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('实际工作台')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '准备全部模型' }))
    await waitFor(() => expect(request).toHaveBeenCalledWith('/api/setup', expect.objectContaining({ method: 'POST', body: JSON.stringify({ action: 'prepare', selections }) })))
    expect(await screen.findByRole('button', { name: '暂停 VoxCPM2' })).toBeEnabled()
    expect(screen.getByRole('progressbar', { name: 'VoxCPM2 下载进度' })).toBeVisible()
    expect(screen.getByRole('progressbar', { name: 'Whisper 下载进度' })).toHaveAttribute('aria-valuenow', '100')
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.queryByText('实际工作台')).not.toBeInTheDocument()
    view.unmount()
  })
  it('keeps the selected accelerator and fallback reason visible after environment preparation', () => {
    const view = render(<SetupScreen state={{ ...state, environment: [{ id: 'acceleration', name: 'GPU', status: 'ready', detail: 'AMD GPU 驱动不可用；使用 CPU' }] }} onAction={vi.fn()} />)
    expect(screen.getByText('AMD GPU 驱动不可用；使用 CPU')).toBeInTheDocument()
    view.unmount()
  })
  it('keeps the workbench gated during downloads and sends the setup token with pause', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response(state)).mockResolvedValue(response({ ...state, models: [{ ...state.models[0], status: 'paused' }] }))
    vi.stubGlobal('fetch', fetch)
    const view = render(<SetupGate><div>实际工作台</div></SetupGate>)
    await screen.findByText('Qwen3 Aligner')
    expect(screen.queryByText('实际工作台')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '查看内置示例' })).toHaveAttribute('href', '/examples/index.html')
    fireEvent.click(screen.getByRole('button', { name: '暂停 Qwen3 Aligner' }))
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/setup', expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ 'X-YouDub-Setup': 'setup-token' }), body: JSON.stringify({ action: 'pause', id: 'qwen' }) })))
    await screen.findByText('已暂停')
    view.unmount(); vi.unstubAllGlobals()
  })
  it('keeps translation setup gated while any model or dependency is still preparing', async () => {
    const models = modelChoices.models.map(model => ({ ...model, status: 'ready' as const, received: model.total }))
    const pending: SetupState = { ...modelChoices, models: models.map(model => model.id === 'qwen' ? { ...model, status: 'paused' } : model), resourceSelection: { ...modelChoices.resourceSelection!, required: false } }
    const dependencies: SetupState = { ...pending, models, environment: [{ id: 'dependencies', name: '运行依赖', status: 'running' }] }
    const request = vi.fn().mockResolvedValueOnce(pending).mockResolvedValueOnce(dependencies).mockResolvedValue({ ...dependencies, phase: 'ready', environment: [{ id: 'dependencies', name: '运行依赖', status: 'ready' }] })
    const view = render(<SetupGate request={request}><div>翻译服务配置</div></SetupGate>)
    await screen.findByRole('button', { name: '继续 Qwen3 Aligner' })
    expect(screen.queryByText('翻译服务配置')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '继续下载' }))
    await screen.findByText('运行依赖')
    expect(screen.queryByText('翻译服务配置')).not.toBeInTheDocument()
    await screen.findByText('翻译服务配置', {}, { timeout: 2000 })
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    view.unmount()
  })
  it('uses the embedding host transport and source screen controls until it is ready', async () => {
    const request = vi.fn().mockResolvedValue(state)
    const onReady = vi.fn(), onOpenExamples = vi.fn()
    const view = render(<SetupGate request={request} onReady={onReady} screenProps={{ wordmarkSrc: 'data:image/svg+xml,logo', themeControl: <button>宿主主题</button>, examplesHref: '/api/youdub/examples/index.html', onOpenExamples }}><div>实际工作台</div></SetupGate>)
    await screen.findByText('Qwen3 Aligner')
    expect(request).toHaveBeenCalledWith('/api/setup', expect.objectContaining({ signal: expect.any(AbortSignal) }))
    expect(screen.getByLabelText('YouDub').querySelector('image')).toHaveAttribute('href', 'data:image/svg+xml,logo')
    expect(screen.getByRole('button', { name: '宿主主题' })).toBeVisible()
    fireEvent.click(screen.getByRole('link', { name: '查看内置示例' }))
    expect(onOpenExamples).toHaveBeenCalledOnce()
    expect(onReady).not.toHaveBeenCalled()
    request.mockResolvedValue({ ...state, phase: 'ready' })
    fireEvent.click(screen.getByRole('button', { name: '暂停全部' }))
    await screen.findByText('实际工作台')
    expect(onReady).toHaveBeenCalledOnce()
    view.unmount()
  })
  it('surfaces failed requests without automatically retrying or opening the workbench', async () => {
    const fetch = vi.fn().mockResolvedValue(response({ error: 'backend unavailable' }, 503))
    vi.stubGlobal('fetch', fetch)
    const view = render(<SetupGate><div>实际工作台</div></SetupGate>)
    expect(await screen.findByRole('alert')).toHaveTextContent('503')
    expect(screen.queryByText('实际工作台')).not.toBeInTheDocument()
    expect(fetch).toHaveBeenCalledTimes(1)
    view.unmount(); vi.unstubAllGlobals()
  })
  it('shows original failures and includes Qwen without an optional checkbox', () => {
    const view = render(<SetupScreen state={{ ...state, models: [{ ...state.models[0], status: 'failed', error: 'connect ECONNREFUSED proxy:20171' }] }} onAction={vi.fn()} />)
    expect(screen.getByRole('alert')).toHaveTextContent('ECONNREFUSED')
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重试 Qwen3 Aligner' })).toBeEnabled()
    expect(screen.getByRole('progressbar', { name: 'Qwen3 Aligner 下载进度' })).toHaveAttribute('aria-valuenow', '50')
    view.unmount()
  })
  it('copies the complete setup error, including multiline diagnostics', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const error = 'Python exited (1).\nTraceback:\nWhisper requires ffmpeg in PATH.'
    const view = render(<SetupScreen state={{ ...state, phase: 'failed', error }} onAction={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '复制日志' }))
    await screen.findByRole('button', { name: '已复制日志' })
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining(error))
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('YouDub: 0.0.6'))
    expect(writeText.mock.calls[0][0]).not.toContain('setup-token')
    expect(screen.getByRole('alert')).toHaveTextContent('Whisper requires ffmpeg in PATH.')
    view.unmount(); vi.unstubAllGlobals()
  })
  it('copies logs when opening feedback during successful preparation as well as errors', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const view = render(<SetupScreen state={state} onAction={vi.fn()} />)
    expect(screen.getByRole('button', { name: '复制日志' })).toBeEnabled()
    const link = screen.getByRole('link', { name: '反馈 Issue' })
    const body = new URL(link.getAttribute('href')!).searchParams.get('body')!
    expect(body).toContain('阶段: 模型准备')
    expect(body).not.toContain(state.token)
    expect(link).toHaveAttribute('target', '_blank')
    link.addEventListener('click', event => event.preventDefault())
    fireEvent.click(link)
    await screen.findByRole('button', { name: '已复制日志' })
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Qwen3 Aligner'))
    view.unmount(); vi.unstubAllGlobals()
  })
  it('copies full logs when opening feedback and surfaces clipboard denial without losing the report', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('Permission denied'))
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const error = '下载错误\n'.repeat(3000) + '最后的原因'
    const view = render(<SetupDiagnostics state={{ ...state, error }} />)
    const feedback = screen.getByRole('link', { name: '反馈 Issue' })
    feedback.addEventListener('click', event => event.preventDefault())
    fireEvent.click(feedback)
    expect(await screen.findByText(/复制失败：Permission denied/)).toBeVisible()
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('最后的原因'))
    expect((screen.getByRole('textbox', { name: '诊断日志内容' }) as HTMLTextAreaElement).value).toContain('最后的原因')
    expect(screen.getByRole('button', { name: '复制日志' })).toBeEnabled()
    view.unmount(); vi.unstubAllGlobals()
  })
  it('provides feedback even when the first setup request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Failed to fetch')))
    const view = render(<SetupGate><div>实际工作台</div></SetupGate>)
    await screen.findByRole('button', { name: '重新连接' })
    const body = new URL(screen.getByRole('link', { name: '反馈 Issue' }).getAttribute('href')!).searchParams.get('body')!
    expect(body).toContain('连接准备服务')
    expect((screen.getByRole('textbox', { name: '诊断日志内容' }) as HTMLTextAreaElement).value).toContain('连接错误:\nFailed to fetch')
    view.unmount(); vi.unstubAllGlobals()
  })
})
