import type { Context } from 'cordis'
import type { ComponentType } from 'react'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { LanguageProvider } from '@/lib/i18n'
import { PluginContextProvider, type EditorProps, type SettingsSectionProps, type SlotMap } from './sdk'
import { apply } from './builtin/localize-editor'

afterEach(() => { cleanup(); window.localStorage.clear() })
it('uses the refreshed runtime capabilities without replacing them with a stale catalog snapshot', async () => {
  const capabilities = ['asr', 'translation'].map((kind) => ({ adapter: kind, capability: kind, available: true, execution: kind === 'translation' ? 'remote' : 'local', models: [{ id: kind, devices: [kind === 'translation' ? 'remote' : 'cpu'], source_languages: ['en'], target_languages: ['zh'], voice_modes: [], voices: [] }] }))
  const request = vi.fn(async (path: string) => path === '/api/v2/runtime' ? { devices: [{ id: 'cpu', available: true }], capabilities } : { providers: capabilities.map((item) => ({ ...item, available: false })), workflows: [] })
  let Editor!: ComponentType<EditorProps>
  const context = { apiClient: { request }, slots: { register: (slot: string, entry: SlotMap['config.editors']) => { if (slot === 'config.editors') Editor = entry.component; return () => {} } }, effect: (effect: () => unknown) => effect() } as unknown as Context
  apply(context)
  const value = { output_mode: 'subtitles', source_language: 'en', target_language: 'zh', keep_background: false, asr: { adapter: 'asr', model: 'asr', device: 'cpu' }, translation: { adapter: 'translation', model: 'translation', device: 'remote' }, tts: null, separation: null }
  const { rerender } = render(<PluginContextProvider context={context}><LanguageProvider><Editor mode="options" value={value} schema={{}} diagnostics={[]} readOnly={false} onChange={vi.fn()} /></LanguageProvider></PluginContextProvider>)
  await screen.findByLabelText('目标语言')
  expect(screen.queryByLabelText('语音识别模型')).not.toBeInTheDocument()
  expect(screen.queryByLabelText('专名提示（可选）')).not.toBeInTheDocument()
  await userEvent.setup().click(screen.getByLabelText('目标语言'))
  expect(await screen.findByRole('option', { name: '中文' })).toBeInTheDocument()
  await userEvent.setup().keyboard('{Escape}')
  // Reruns retain their full editor so old model selections can be corrected.
  rerender(<PluginContextProvider context={context}><LanguageProvider><Editor value={value} schema={{}} diagnostics={[]} readOnly={false} onChange={vi.fn()} /></LanguageProvider></PluginContextProvider>)
  expect(screen.getByLabelText('语音识别模型')).not.toHaveTextContent('不可用')
  expect(request).toHaveBeenCalledTimes(1)
})

it('registers model configuration in settings and saves it as task defaults with explicit failure handling', async () => {
  const defaults = { output_mode: 'subtitles', source_language: 'en', target_language: 'zh', keep_background: false, asr: { adapter: 'asr', model: 'asr', device: 'cpu' }, translation: { adapter: 'translation', model: 'translation', device: 'remote' }, tts: null, separation: null }
  const capabilities = ['asr', 'translation'].map((kind) => ({ adapter: kind, capability: kind, available: true, execution: kind === 'translation' ? 'remote' : 'local', models: [{ id: kind, devices: [kind === 'translation' ? 'remote' : 'cpu'], source_languages: ['en'], target_languages: ['zh'], voice_modes: [], voices: [] }] }))
  let finish!: (value: unknown) => void
  let fail!: (error: Error) => void
  const request = vi.fn(async (path: string, init?: RequestInit) => {
    if (init?.method === 'PATCH') return new Promise((resolve, reject) => { finish = resolve; fail = reject })
    if (path === '/api/v2/runtime') return { devices: [{ id: 'cpu', available: true }], capabilities }
    return { providers: [], workflows: [{ id: 'youdub.localize', defaults }] }
  })
  let Section!: ComponentType<SettingsSectionProps>
  const context = { apiClient: { request }, slots: { register: (slot: string, entry: SlotMap['settings.sections']) => { if (slot === 'settings.sections') Section = entry.component; return () => {} } }, effect: (effect: () => unknown) => effect() } as unknown as Context
  apply(context)
  const genericSave = vi.fn()
  render(<PluginContextProvider context={context}><LanguageProvider><Section settings={{}} save={genericSave} /></LanguageProvider></PluginContextProvider>)
  const hint = await screen.findByLabelText('专名提示（可选）')
  expect(screen.getByLabelText('语音识别模型')).toHaveTextContent('asr')
  const user = userEvent.setup()
  await user.type(hint, 'YouDub')
  await user.click(screen.getByRole('button', { name: '保存默认配置' }))
  expect(hint).toBeDisabled()
  await act(async () => fail(new Error('Save failed')))
  expect(await screen.findByText('Save failed')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '已保存' })).not.toBeInTheDocument()
  expect(request.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(1)
  await user.click(screen.getByRole('button', { name: '保存默认配置' }))
  await act(async () => finish({ defaults }))
  await screen.findByRole('button', { name: '已保存' })
  const patch = request.mock.calls.find(([, init]) => init?.method === 'PATCH')!
  expect(patch[0]).toBe('/api/v2/settings')
  expect(JSON.parse(patch[1]!.body as string)).toMatchObject({ defaults: { ...defaults, asr: { ...defaults.asr, initial_prompt: 'YouDub' } } })
  expect(genericSave).not.toHaveBeenCalled()
  await user.type(hint, ' changed')
  await waitFor(() => expect(screen.getByRole('button', { name: '保存默认配置' })).toBeInTheDocument())
})
