import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { SetupGate } from './setup-gate'
import { SetupScreen, type SetupState } from './setup-screen'

const state: SetupState = { phase: 'models', platform: 'darwin', arch: 'arm64', token: 'setup-token', canRetry: true,
  environment: [{ id: 'python', name: 'Python 3.12', status: 'ready' }],
  models: [{ id: 'qwen', name: 'Qwen3 Aligner', variant: '0.6B', purpose: '字幕对齐', status: 'downloading', received: 50, total: 100, speed: 10 }],
}
const response = (value: unknown, status = 200) => ({ ok: status === 200, status, text: async () => JSON.stringify(value) })
describe('first-run setup', () => {
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
  it('opens the workbench only after the backend becomes ready', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ ...state, phase: 'ready' })))
    const view = render(<SetupGate><div>实际工作台</div></SetupGate>)
    await screen.findByText('实际工作台')
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    view.unmount(); vi.unstubAllGlobals()
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
    fireEvent.click(screen.getByRole('button', { name: '复制错误' }))
    await screen.findByRole('button', { name: '已复制' })
    expect(writeText).toHaveBeenCalledWith(error)
    expect(screen.getByRole('alert')).toHaveTextContent('Whisper requires ffmpeg in PATH.')
    view.unmount(); vi.unstubAllGlobals()
  })
})
