'use client'

import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { BrandMark } from './brand/brand-mark'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import type { Runtime, TaskConfig } from '@/plugin/builtin/localize-contracts'

type Settings = { connections: { adapter: string; base_url: string; has_api_key: boolean; api_key_hint?: string | null }[]; defaults?: TaskConfig | null; plugins?: Record<string, { translationDeferred?: boolean }> }
async function api(path: string, init?: RequestInit) {
  const response = await fetch(path, { ...init, credentials: 'same-origin', cache: 'no-store' })
  const body = await response.json()
  if (!response.ok) throw new Error(body.error?.message || body.detail || `请求失败（HTTP ${response.status}）`)
  return body
}

export function TranslationSetup({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [csrf, setCsrf] = useState('')
  const [url, setUrl] = useState('https://api.openai.com/v1')
  const [model, setModel] = useState('')
  const [key, setKey] = useState('')
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let stopped = false
    const controller = new AbortController()
    void (async () => {
      try {
        const session = await api('/api/auth/session', { signal: controller.signal })
        const current: Settings = await api('/api/v2/settings', { signal: controller.signal })
        if (stopped) return
        setCsrf(session.csrf_token); setSettings(current)
        const connection = current.connections.find(item => item.adapter === 'openai')
        if (connection) setUrl(connection.base_url)
        const savedModel = current.defaults?.translation?.model
        if (savedModel) setModel(savedModel)
        setReady(Boolean(connection?.has_api_key && savedModel) || current.plugins?.['youdub.onboarding']?.translationDeferred === true)
      } catch (failure) { if (!stopped) setError(failure instanceof Error ? failure.message : String(failure)) }
    })()
    return () => { stopped = true; controller.abort() }
  }, [attempt])
  async function mutate(path: string, body: unknown, method = 'PATCH') {
    return api(path, { method, headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify(body) })
  }
  async function save(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true); setError('')
    try {
      await mutate('/api/v2/settings/test-connection', { base_url: url.trim(), model: model.trim(), ...(key.trim() ? { api_key: key.trim() } : {}) }, 'POST')
      const runtime: Runtime = await api('/api/v2/runtime')
      const provider = runtime.capabilities.find(item => item.capability === 'asr' && item.models.length)
      const asr = provider?.models[0]
      // Configuration is saved before model installation. The official subtitle
      // workflow starts with Whisper tiny; readiness is checked when it runs.
      const asrSelection = settings?.defaults?.asr ?? (provider && asr
        ? { adapter: provider.adapter, model: asr.id, device: asr.devices[0] }
        : { adapter: 'whisper', model: 'tiny', device: 'cpu' })
      await mutate('/api/v2/settings', { connection: { adapter: 'openai', base_url: url.trim(), ...(key.trim() ? { api_key: key.trim() } : {}) } })
      setKey('')
      await mutate('/api/v2/settings', { defaults: { source_language: 'auto', target_language: 'zh', output_mode: 'subtitles', keep_background: false,
        asr: asrSelection, tts: null, separation: null,
        ...settings?.defaults, translation: { adapter: 'openai', model: model.trim(), device: 'remote' } } })
      setReady(true)
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { setBusy(false) }
  }
  async function skip() {
    setBusy(true); setError('')
    try { await mutate('/api/v2/settings', { plugin: { id: 'youdub.onboarding', config: { translationDeferred: true } } }); setReady(true) }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { setBusy(false) }
  }
  if (ready) return children
  if (!settings) return <main className="mx-auto max-w-xl space-y-4 p-8">{error ? <><p role="alert">{error}</p><Button onClick={() => { setError(''); setAttempt(value => value + 1) }}>重新连接</Button></> : <p role="status">检查翻译服务配置…</p>}</main>
  const savedKey = settings.connections.find(item => item.adapter === 'openai' && item.base_url === url.trim() && item.has_api_key)
  return <main className="mx-auto max-w-xl space-y-6 px-6 py-12">
    <BrandMark wordmark className="h-7" />
    <div className="space-y-2"><h1 className="text-xl font-semibold">配置翻译服务</h1><p className="text-sm text-muted-foreground">填写 OpenAI 兼容接口。翻译时会向该服务发送识别出的字幕文本；测试连接会发送一句简短测试文本。</p></div>
    <form className="space-y-5 rounded-2xl border border-border bg-card p-6" onSubmit={save}>
      <div className="space-y-2"><Label htmlFor="setup-llm-url">接口地址</Label><Input id="setup-llm-url" type="url" value={url} disabled={busy} onChange={event => setUrl(event.target.value)} required /></div>
      <div className="space-y-2"><Label htmlFor="setup-llm-model">模型名称</Label><Input id="setup-llm-model" value={model} disabled={busy} onChange={event => setModel(event.target.value)} placeholder="例如 gpt-4.1-mini" required /></div>
      <div className="space-y-2"><Label htmlFor="setup-llm-key">API 密钥{savedKey ? ' · 已保存' : ''}</Label><Input id="setup-llm-key" type="password" autoComplete="new-password" value={key} disabled={busy} onChange={event => setKey(event.target.value)} required={!savedKey} placeholder={savedKey ? savedKey.api_key_hint || '****' : ''} /><p className="text-xs text-muted-foreground">密钥保存到系统凭据管理器，可在设置中修改。</p></div>
      {error && <p role="alert" className="text-sm text-status-danger-fg">{error}</p>}
      <div className="flex flex-wrap gap-3"><Button type="submit" disabled={busy}>{busy && <Loader2 className="animate-spin" />}测试连接并继续</Button><Button type="button" variant="ghost" disabled={busy} onClick={() => void skip()}>稍后配置</Button></div>
      <p className="text-xs text-muted-foreground">稍后配置仍可进入工作台，开始翻译任务前需在设置中完成连接。</p>
    </form>
  </main>
}
