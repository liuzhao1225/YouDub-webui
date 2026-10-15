'use client'

import { useState } from 'react'
import { ArrowDownToLine, AudioLines, Check, CircleAlert, Copy, Cpu, Loader2, Mic2, Moon, Pause, Play, RotateCcw, SlidersHorizontal, Sun, Waves } from 'lucide-react'
import { BrandMark } from '@/components/brand/brand-mark'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export interface SetupModel {
  id: string; name: string; variant: string; purpose: string;
  status: 'pending' | 'downloading' | 'paused' | 'ready' | 'failed';
  received: number; total: number; speed: number; error?: string
}
export interface SetupState {
  phase: 'environment' | 'models' | 'starting' | 'ready' | 'failed'; platform: string; arch: string;
  environment: { id: string; name: string; status: 'pending' | 'running' | 'ready' | 'failed'; detail?: string }[];
  models: SetupModel[]; error?: string; canRetry: boolean; token: string
}
export type SetupAction = 'pause' | 'resume' | 'retry'
export function sizeLabel(bytes: number) {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`
  return `${Math.round(bytes / 1e6)} MB`
}
const icons = { whisper: AudioLines, voxcpm: Mic2, demucs: Waves, qwen: SlidersHorizontal }
function Progress({ value, label, paused = false }: { value: number; label: string; paused?: boolean }) {
  const percent = Math.floor(Math.min(1, value) * 100)
  return <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="h-1.5 overflow-hidden rounded-full bg-accent">
    <div className={cn('h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none', value >= 1 ? 'bg-brand-blue' : paused ? 'bg-subtle-foreground' : 'bg-brand-gradient')} style={{ width: `${percent}%` }} />
  </div>
}
export function SetupScreen({ state, busy = false, onAction, onReset }: {
  state: SetupState; busy?: boolean; onAction: (action: SetupAction, id?: string) => void; onReset?: () => void
}) {
  const [light, setLight] = useState(false)
  const [copiedError, setCopiedError] = useState('')
  const [copyFailure, setCopyFailure] = useState('')
  const total = state.models.reduce((sum, model) => sum + model.total, 0)
  const received = state.models.reduce((sum, model) => sum + model.received, 0)
  const speed = state.models.reduce((sum, model) => sum + model.speed, 0)
  const active = state.models.filter(model => model.status === 'downloading').length
  const complete = state.models.filter(model => model.status === 'ready').length
  const failed = state.models.some(model => model.status === 'failed')
  const environmentReady = state.environment.every(step => step.status === 'ready')
  const platform = ({ darwin: 'macOS', win32: 'Windows', linux: 'Linux' } as Record<string, string>)[state.platform] || state.platform
  const arch = state.platform === 'darwin' && state.arch === 'arm64' ? 'Apple Silicon' : state.arch
  const errors = [state.error, ...state.models.map(model => model.error)].filter(Boolean)
  const errorText = errors.join('\n\n')
  const copied = copiedError === errorText
  async function copyError() {
    setCopyFailure('')
    try { await navigator.clipboard.writeText(errorText); setCopiedError(errorText) }
    catch (error) { setCopiedError(''); setCopyFailure(`复制失败：${error instanceof Error ? error.message : String(error)}`) }
  }
  return <div className="min-h-screen">
    <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6 sm:px-10">
      <span aria-label="YouDub"><BrandMark animated wordmark className="h-7" /></span>
      <div className="flex items-center gap-2">
        <span className="mr-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground"><Cpu className="size-3.5" />{platform} · {arch}</span>
        {onReset && <Button variant="ghost" size="icon-sm" aria-label="重置下载预览" title="重置下载预览" onClick={onReset}><RotateCcw /></Button>}
        <Button variant="ghost" size="icon-sm" aria-label={light ? '切换深色主题' : '切换浅色主题'} onClick={() => { setLight(!light); document.documentElement.classList.toggle('dark', light) }}>{light ? <Moon /> : <Sun />}</Button>
      </div>
    </header>
    <main className="mx-auto max-w-3xl px-5 py-8 sm:px-8 sm:py-12">
      <h1 className="mb-6 flex items-center gap-3 text-base font-medium">
        <span className={cn('inline-flex items-center gap-2', environmentReady && 'text-muted-foreground')}>{environmentReady ? <Check className="size-4 text-brand-blue" /> : state.phase === 'failed' ? <CircleAlert className="size-4 text-status-danger-fg" /> : <Loader2 className="size-4 animate-spin text-brand-pink" />}环境准备</span>
        <span className="text-subtle-foreground">/</span><span className={cn('inline-flex items-center gap-2', !environmentReady && 'text-muted-foreground')}>{state.phase === 'ready' && <Check className="size-4 text-brand-blue" />}模型准备</span>
      </h1>
      {!environmentReady && <section aria-label="环境准备" className="mb-5 divide-y divide-border rounded-2xl border border-border bg-card px-5 shadow-card">
        {state.environment.map(step => <div key={step.id} className="flex items-center justify-between gap-3 py-4 text-sm"><span>{step.name}</span><span className="inline-flex items-center gap-2 text-xs text-muted-foreground">{step.status === 'ready' ? <Check className="size-4 text-brand-blue" /> : step.status === 'running' ? <><Loader2 className="size-3.5 animate-spin" />准备中</> : step.status === 'failed' ? <CircleAlert className="size-4 text-status-danger-fg" /> : '等待中'}</span></div>)}
      </section>}
      <section aria-label="模型下载" className="overflow-hidden rounded-2xl border border-border bg-card shadow-card">
        <div className="space-y-4 border-b border-border bg-muted p-5">
          <div className="flex items-center justify-between gap-3 text-xs tabular-nums">
            <span className="font-medium">{state.phase === 'starting' ? '校验并启动工作台' : state.phase === 'ready' ? '全部就绪' : active ? `${active} 个模型并行下载` : failed ? '下载失败' : !environmentReady ? '等待环境就绪' : '下载已暂停'}</span>
            <span className="text-muted-foreground">{complete}/{state.models.length} 已完成<span className="ml-3 text-lg font-medium text-foreground">{total ? Math.floor(received / total * 100) : 0}%</span></span>
          </div>
          <Progress value={total ? received / total : 0} label="总下载进度" paused={!active} />
        </div>
        <div className="divide-y divide-border px-5">
          {state.models.map(model => {
            const done = model.status === 'ready'
            const Icon = icons[model.id as keyof typeof icons] || AudioLines
            return <div key={model.id} className="flex items-center gap-3 py-5 sm:gap-4">
              <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent', done ? 'text-brand-blue' : 'text-brand-pink')}><Icon className="size-4.5" /></span>
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 truncate text-sm font-medium" title={`${model.name} ${model.variant}`}>{model.name}{model.variant && <span className="ml-1.5 text-[11px] font-normal text-subtle-foreground">{model.variant}</span>}</span>
                  <span className="flex-1 whitespace-nowrap text-xs text-muted-foreground">{model.purpose}</span>
                  <span className={cn('shrink-0 text-xs tabular-nums', done ? 'text-status-success-fg' : model.status === 'failed' ? 'text-status-danger-fg' : model.status === 'downloading' ? 'text-status-running-fg' : 'text-muted-foreground')}>
                    {done ? '已就绪' : model.status === 'failed' ? '失败' : model.status === 'pending' ? '待下载' : model.status === 'paused' ? '已暂停' : <><span className="mr-2 hidden sm:inline">{sizeLabel(model.speed)}/s</span>{model.total ? Math.floor(model.received / model.total * 100) : 0}%</>}
                  </span>
                  {done ? <span className="flex size-7 shrink-0 items-center justify-center"><Check className="size-4 text-brand-blue" /></span> : <Button variant="ghost" size="icon-xs" disabled={busy || state.phase !== 'models' || model.status === 'pending'} aria-label={`${model.status === 'downloading' ? '暂停' : model.status === 'failed' ? '重试' : '继续'} ${model.name}`} onClick={() => onAction(model.status === 'downloading' ? 'pause' : model.status === 'failed' ? 'retry' : 'resume', model.id)}>{model.status === 'downloading' ? <Pause /> : model.status === 'failed' ? <RotateCcw /> : <Play />}</Button>}
                </div>
                <div className="flex items-center gap-3"><div className="min-w-0 flex-1"><Progress value={model.total ? model.received / model.total : 0} label={`${model.name} 下载进度`} paused={model.status === 'paused'} /></div><span className="shrink-0 text-[11px] tabular-nums text-subtle-foreground">{sizeLabel(model.received)} / {sizeLabel(model.total)}</span></div>
              </div>
            </div>
          })}
        </div>
      </section>
      {errors.length > 0 && <div role="alert" className="mt-4 rounded-xl border border-status-danger/25 bg-status-danger/10 p-4 text-xs text-status-danger-fg">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words font-sans">{errorText}</pre>
          <Button variant="ghost" size="icon-xs" aria-label={copied ? '已复制' : '复制错误'} title={copied ? '已复制' : '复制错误'} onClick={copyError}>{copied ? <Check /> : <Copy />}</Button>
        </div>
        {copyFailure && <p role="status" className="mt-2">{copyFailure}</p>}
      </div>}
      <div className="mt-5 flex items-center justify-between gap-3">
        <span className="text-xs tabular-nums text-muted-foreground">{sizeLabel(received)} / {sizeLabel(total)}{speed > 0 && <span className="ml-3 text-subtle-foreground">{sizeLabel(speed)}/s</span>}</span>
        {state.phase === 'failed' ? state.canRetry && <Button disabled={busy} onClick={() => onAction('retry')}><RotateCcw />重新准备</Button> : state.phase === 'models' ? <Button variant="outline" size="lg" disabled={busy} onClick={() => onAction(active ? 'pause' : failed ? 'retry' : 'resume')}>{active ? <Pause /> : failed ? <RotateCcw /> : <ArrowDownToLine />}{active ? '暂停全部' : failed ? '重试下载' : '继续下载'}</Button> : state.phase === 'starting' && <Loader2 aria-label="启动中" className="size-5 animate-spin text-brand-pink" />}
      </div>
    </main>
  </div>
}
