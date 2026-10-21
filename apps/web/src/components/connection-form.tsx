import { useEffect, useId, useMemo, useRef, type ReactNode } from 'react'
import { Check, Loader2 } from 'lucide-react'
import { ConnectionController, type ConnectionRequest } from '@/runtime/connection'
import { useObservableSource } from '@/plugin/web-react'
import { useText } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { InlineAlert } from './inline-alert'

export type ConnectionFormProps = ({ request: ConnectionRequest; adapter?: string; controller?: never } | {
  controller: ConnectionController; request?: never; adapter?: never
}) & {
  title?: ReactNode
  className?: string
  onDirtyChange?(dirty: boolean): void
  onSaved?(): void
  onSubmit?(): Promise<unknown>
  submitLabel?: ReactNode
  secondaryAction?: { label: ReactNode; onClick(): void | Promise<void> }
  disabled?: boolean
  error?: string
}

export function ConnectionForm({ request, adapter, controller: supplied, title, className, onDirtyChange, onSaved,
  onSubmit, submitLabel, secondaryAction, disabled, error }: ConnectionFormProps) {
  const tx = useText(), id = useId()
  const controller = useMemo(() => supplied ?? new ConnectionController(request!, adapter), [supplied, request, adapter])
  const state = useObservableSource(controller)
  const reportDirty = useRef(onDirtyChange)
  useEffect(() => { reportDirty.current = onDirtyChange }, [onDirtyChange])
  useEffect(() => {
    if (supplied) return
    void controller.start()
    return controller.stop
  }, [controller, supplied])
  useEffect(() => { reportDirty.current?.(state.dirty) }, [controller, state.dirty])
  useEffect(() => () => { reportDirty.current?.(false) }, [controller])
  const busy = Boolean(disabled || state.busy || state.loading)
  const translation = controller.adapter === 'openai'
  const validation = state.validation === 'url' ? tx('Enter a valid HTTP(S) service URL.', '请填写有效的 HTTP(S) 服务地址。', '有効な HTTP(S) サービス URL を入力してください。')
    : state.validation === 'model' ? tx('Enter a model name.', '请填写模型名称。', 'モデル名を入力してください。')
      : state.validation === 'key' ? tx('Enter an API key for this address.', '请填写当前服务地址对应的 API Key。', 'このサービス URL の API キーを入力してください。') : ''
  const failure = error || state.error || validation
  if (!state.loaded) return <div className="space-y-4">{failure ? <><InlineAlert>{failure}</InlineAlert><Button variant="outline" onClick={() => void controller.start()} disabled={busy}>{tx('Reload connection', '重新读取连接', '接続を再読み込み')}</Button></> : <p role="status" className="text-sm text-muted-foreground">{tx('Loading connection…', '正在读取连接…', '接続を読み込み中…')}</p>}</div>
  return <form className={cn('space-y-4', className)} onSubmit={event => {
    event.preventDefault()
    if (busy) return
    if (onSubmit) void onSubmit()
    else void controller.save().then(saved => { if (saved) onSaved?.() })
  }}>
    {title && <h3 className="text-sm font-medium">{title}</h3>}
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-2"><Label htmlFor={`${id}-url`}>{tx('Service URL', '服务地址', 'サービス URL')}</Label><Input id={`${id}-url`} type="url" value={state.url} disabled={busy} onChange={event => controller.change({ url: event.target.value })} required /></div>
      {translation && <div className="space-y-2"><Label htmlFor={`${id}-model`}>{tx('Model name', '模型名称', 'モデル名')}</Label><Input id={`${id}-model`} value={state.model} disabled={busy} onChange={event => controller.change({ model: event.target.value })} required={!state.clearKey} /></div>}
      <div className="space-y-2 sm:col-span-2"><Label htmlFor={`${id}-key`}>{tx('API key', 'API 密钥', 'API キー')}{state.savedKey ? tx(' · saved', ' · 已保存', ' · 保存済み') : ''}</Label><Input id={`${id}-key`} type="password" autoComplete="new-password" value={state.key} disabled={busy || state.clearKey} onChange={event => controller.change({ key: event.target.value })} required={translation && !state.clearKey && !state.savedKey} placeholder={state.savedKey ? state.connection?.api_key_hint || '****' : ''} /></div>
    </div>
    {!onSubmit && state.connection?.has_api_key && <label className="flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" disabled={busy} checked={state.clearKey} onChange={event => controller.change({ clearKey: event.target.checked })} />{tx('Clear saved API key', '清除已保存密钥', '保存済みキーを削除')}</label>}
    {state.externalChange && <InlineAlert tone="warning">{tx('Saved connection changed. Your draft is preserved.', '已保存的连接发生变化，当前草稿已保留。', '保存済みの接続が変更されました。下書きは保持されています。')} <Button type="button" variant="link" size="sm" disabled={busy} onClick={() => void controller.reload()}>{tx('Reload saved connection', '读取已保存的连接', '保存済みの接続を読み込む')}</Button></InlineAlert>}
    {failure && <InlineAlert>{state.readbackFailed && <p>{tx('The save request completed, but reading the saved connection failed.', '保存请求已完成，但重新读取连接失败。', '保存リクエストは完了しましたが、接続の再読み込みに失敗しました。')}</p>}{failure}</InlineAlert>}
    {state.testedAt && <p role="status" className="text-xs text-status-success-fg">{tx('Connection passed', '连接测试通过', '接続テスト成功')} · <time dateTime={state.testedAt}>{new Date(state.testedAt).toLocaleTimeString()}</time></p>}
    <div className="flex flex-wrap gap-3">
      <Button type="submit" variant={onSubmit ? 'default' : 'outline'} disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : state.saved ? <Check /> : null}{submitLabel ?? (state.saved ? tx('Saved', '已保存', '保存済み') : tx('Save changes', '保存修改', '変更を保存'))}</Button>
      {!onSubmit && translation && <Button type="button" variant="ghost" disabled={busy || state.clearKey || !state.url.trim() || !state.model.trim() || (!state.key.trim() && !state.savedKey)} onClick={() => void controller.test()}>{tx('Test connection', '测试连接', '接続をテスト')}</Button>}
      {secondaryAction && <Button type="button" variant="ghost" disabled={busy} onClick={() => void secondaryAction.onClick()}>{secondaryAction.label}</Button>}
    </div>
  </form>
}
