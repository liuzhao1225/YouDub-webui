import type { Context } from 'cordis'
import type { ComponentType } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { LanguageProvider } from '@/lib/i18n'
import { PluginContextProvider, type EditorProps, type SlotMap } from './sdk'
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

it('keeps legacy task editing without registering global processing defaults', () => {
  const register = vi.fn((_slot: string, _entry: unknown) => () => {})
  apply({ apiClient: { request: vi.fn() }, slots: { register }, effect: (effect: () => unknown) => effect() } as unknown as Context)
  expect(register.mock.calls.map(call => call[0])).toEqual(['config.editors'])
})
