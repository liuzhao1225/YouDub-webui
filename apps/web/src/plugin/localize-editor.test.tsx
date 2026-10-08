import type { Context } from 'cordis'
import type { ComponentType } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { LanguageProvider } from '@/lib/i18n'
import { PluginContextProvider, type EditorProps, type SlotMap } from './sdk'
import { apply } from './builtin/localize-editor'

afterEach(() => { cleanup(); window.localStorage.clear() })
it('uses the refreshed runtime capabilities without replacing them with a stale catalog snapshot', async () => {
  const capabilities = ['asr', 'translation'].map((kind) => ({ adapter: kind, capability: kind, available: true, execution: kind === 'translation' ? 'remote' : 'local', models: [{ id: kind, devices: [kind === 'translation' ? 'remote' : 'cpu'], source_languages: ['en'], target_languages: ['zh'], voice_modes: [], voices: [] }] }))
  const request = vi.fn(async (path: string) => path === '/api/v2/runtime' ? { devices: [{ id: 'cpu', available: true }], capabilities } : { providers: capabilities.map((item) => ({ ...item, available: false })), workflows: [] })
  let Editor!: ComponentType<EditorProps>
  const context = { apiClient: { request }, slots: { register: (_slot: string, entry: SlotMap['config.editors']) => { Editor = entry.component; return () => {} } }, effect: (effect: () => unknown) => effect() } as unknown as Context
  apply(context)
  const value = { output_mode: 'subtitles', source_language: 'en', target_language: 'zh', keep_background: false, asr: { adapter: 'asr', model: 'asr', device: 'cpu' }, translation: { adapter: 'translation', model: 'translation', device: 'remote' }, tts: null, separation: null }
  render(<PluginContextProvider context={context}><LanguageProvider><Editor value={value} schema={{}} diagnostics={[]} readOnly={false} onChange={vi.fn()} /></LanguageProvider></PluginContextProvider>)
  await screen.findByLabelText('语音识别模型')
  expect(screen.getByLabelText('语音识别模型')).not.toHaveTextContent('不可用')
  expect(request).toHaveBeenCalledTimes(1)
})
