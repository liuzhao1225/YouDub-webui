import type { Context } from 'cordis'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { PluginContextProvider } from '@/plugin/sdk'
import { LanguageProvider } from '@/lib/i18n'
import { UpdateNotice as UpdateNoticeView, UpdateProvider as UpdateProviderView, UpdateSettings as UpdateSettingsView } from './app-updates'

import { bindTestComponent } from '@/plugin/test-bindings'
const UpdateNotice = bindTestComponent(UpdateNoticeView, ['useUpdates'])
const UpdateSettings = bindTestComponent(UpdateSettingsView, ['useUpdates'])
const UpdateProvider = bindTestComponent(UpdateProviderView, ['request'])

afterEach(() => { cleanup(); vi.useRealTimers(); window.localStorage.clear() })
const available = { version: '0.0.5', url: 'https://github.com/liuzhao1225/YouDub-webui/releases/tag/v0.0.5',
  download: 'https://github.com/liuzhao1225/YouDub-webui/releases/download/v0.0.5/YouDub-0.0.5-macOS-arm64.dmg', checksum: 'https://github.com/liuzhao1225/YouDub-webui/releases/download/v0.0.5/YouDub-0.0.5-macOS-arm64.dmg.sha256' }
async function mount(automatic = true) {
  const fixture = { automatic, available: null as typeof available | null, error: '' }
  const request = vi.fn(async (path: string, init?: RequestInit) => {
    if (path === '/api/v2/settings') { fixture.automatic = JSON.parse(init!.body as string).plugin.config.automatic; return {} }
    if (path === '/api/v2/updates') return { currentVersion: '0.0.4', supported: true, automatic: fixture.automatic }
    if (fixture.error) throw new Error(fixture.error)
    return { available: fixture.available, checkedAt: new Date().toISOString() }
  })
  const context = { apiClient: { request } } as unknown as Context
  await act(async () => render(<PluginContextProvider context={context}><LanguageProvider><UpdateProvider><UpdateNotice /><UpdateSettings /></UpdateProvider></LanguageProvider></PluginContextProvider>))
  return { fixture, request, checks: () => request.mock.calls.filter(([path]) => path === '/api/v2/updates/check') }
}
it('checks on startup and every hour, shares a quiet update notice and stops on unmount', async () => {
  vi.useFakeTimers()
  const { fixture, checks } = await mount()
  expect(checks()).toHaveLength(1)
  expect(screen.queryByText(/发现新版本/)).not.toBeInTheDocument()
  fixture.available = available
  await act(() => vi.advanceTimersByTimeAsync(60 * 60 * 1000))
  expect(checks()).toHaveLength(2)
  expect(screen.getByText('发现新版本 0.0.5')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: '下载更新' })).toHaveAttribute('href', available.download)
  cleanup()
  await act(() => vi.advanceTimersByTimeAsync(60 * 60 * 1000))
  expect(checks()).toHaveLength(2)
})
it('respects the persisted opt-out and still allows a manual check', async () => {
  vi.useFakeTimers()
  const { fixture, checks } = await mount(false)
  expect(checks()).toHaveLength(0)
  expect(screen.getByLabelText('每小时自动检查更新')).not.toBeChecked()
  fixture.available = available
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '检查更新' })))
  expect(checks()).toHaveLength(1)
  expect(screen.getByRole('link', { name: '下载 0.0.5' })).toHaveAttribute('href', available.download)
  await act(() => vi.advanceTimersByTimeAsync(60 * 60 * 1000))
  expect(checks()).toHaveLength(1)
})
it('saves disabling automatic checks to application settings and cancels the timer', async () => {
  vi.useFakeTimers()
  const { request, checks } = await mount()
  await act(async () => fireEvent.click(screen.getByLabelText('每小时自动检查更新')))
  const patch = request.mock.calls.find(([path]) => path === '/api/v2/settings')
  expect(JSON.parse(patch![1]!.body as string)).toEqual({ plugin: { id: 'youdub.updates', config: { automatic: false } } })
  expect(screen.getByLabelText('每小时自动检查更新')).not.toBeChecked()
  await act(() => vi.advanceTimersByTimeAsync(60 * 60 * 1000))
  expect(checks()).toHaveLength(1)
})
it('surfaces a failed check, clears stale success and waits for explicit retry', async () => {
  vi.useFakeTimers()
  const { fixture, checks } = await mount()
  fixture.error = 'Release server returned HTTP 503'
  await act(() => vi.advanceTimersByTimeAsync(60 * 60 * 1000))
  expect(screen.getByRole('alert')).toHaveTextContent(fixture.error)
  expect(screen.queryByText('当前没有新版本')).not.toBeInTheDocument()
  await act(() => vi.advanceTimersByTimeAsync(60 * 60 * 1000))
  expect(checks()).toHaveLength(2)
  fixture.error = ''
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '检查更新' })))
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(screen.getByText('当前没有新版本')).toBeInTheDocument()
})
