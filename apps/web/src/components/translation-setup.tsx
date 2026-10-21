import { useEffect, useState, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { BrandMark } from './brand/brand-mark'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { TranslationSetupController } from '@/runtime/onboarding'
import { useObservableSource } from '@/plugin/web-react'

export function TranslationSetup({ children }: { children: ReactNode }) {
  const [controller] = useState(() => new TranslationSetupController())
  const { settings, url, model, key, ready, busy, error } = useObservableSource(controller)
  useEffect(() => { controller.start(); return controller.stop }, [controller])
  if (ready) return children
  if (!settings) return <main className="mx-auto max-w-xl space-y-4 p-8">{error ? <><p role="alert">{error}</p><Button onClick={controller.start}>重新连接</Button></> : <p role="status">检查翻译服务配置…</p>}</main>
  const savedKey = settings.connections.find(item => item.adapter === 'openai' && item.base_url === url.trim() && item.has_api_key)
  return <main className="mx-auto max-w-xl space-y-6 px-6 py-12">
    <BrandMark wordmark className="h-7" />
    <div className="space-y-2"><h1 className="text-xl font-semibold">配置翻译服务</h1><p className="text-sm text-muted-foreground">填写 OpenAI 兼容接口。翻译时会向该服务发送识别出的字幕文本；测试连接会发送一句简短测试文本。</p></div>
    <form className="space-y-5 rounded-2xl border border-border bg-card p-6" onSubmit={event => { event.preventDefault(); void controller.save() }}>
      <div className="space-y-2"><Label htmlFor="setup-llm-url">接口地址</Label><Input id="setup-llm-url" type="url" value={url} disabled={busy} onChange={event => controller.change({ url: event.target.value })} required /></div>
      <div className="space-y-2"><Label htmlFor="setup-llm-model">模型名称</Label><Input id="setup-llm-model" value={model} disabled={busy} onChange={event => controller.change({ model: event.target.value })} placeholder="例如 gpt-4.1-mini" required /></div>
      <div className="space-y-2"><Label htmlFor="setup-llm-key">API 密钥{savedKey ? ' · 已保存' : ''}</Label><Input id="setup-llm-key" type="password" autoComplete="new-password" value={key} disabled={busy} onChange={event => controller.change({ key: event.target.value })} required={!savedKey} placeholder={savedKey ? savedKey.api_key_hint || '****' : ''} /><p className="text-xs text-muted-foreground">密钥保存到系统凭据管理器，可在设置中修改。</p></div>
      {error && <p role="alert" className="text-sm text-status-danger-fg">{error}</p>}
      <div className="flex flex-wrap gap-3"><Button type="submit" disabled={busy}>{busy && <Loader2 className="animate-spin" />}测试连接并继续</Button><Button type="button" variant="ghost" disabled={busy} onClick={() => void controller.skip()}>稍后配置</Button></div>
      <p className="text-xs text-muted-foreground">稍后配置仍可进入工作台，开始翻译任务前需在设置中完成连接。</p>
    </form>
  </main>
}
