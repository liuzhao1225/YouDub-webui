import type { ReactNode } from 'react'
import { AudioLines, Check, CircleAlert, Loader2, Mic2, SlidersHorizontal, Waves } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { EnvironmentStep, SetupModel } from '@/runtime/setup-contracts'

export function sizeLabel(bytes: number) {
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(2)} GB` : `${Math.round(bytes / 1e6)} MB`
}
export function ResourceProgress({ value, label, paused = false }: { value: number; label: string; paused?: boolean }) {
  const percent = Math.floor(Math.min(1, value) * 100)
  return <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="h-1.5 overflow-hidden rounded-full bg-accent">
    <div className={cn('h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none', value >= 1 ? 'bg-brand-blue' : paused ? 'bg-subtle-foreground' : 'bg-brand-gradient')} style={{ width: `${percent}%` }} />
  </div>
}
export function EnvironmentSteps({ steps, actions }: { steps: EnvironmentStep[]; actions?: Record<string, ReactNode> }) {
  return <>{steps.map(step => <div key={step.id} className="flex items-center justify-between gap-3 py-4 text-sm"><div><span>{step.name}</span>{step.source && <span className="ml-2 text-xs text-subtle-foreground">{step.source}</span>}{step.detail && <p className="mt-1 break-words text-xs text-muted-foreground">{step.detail}</p>}</div><span className="inline-flex shrink-0 items-center gap-2 text-xs text-muted-foreground">{actions?.[step.id] || (step.status === 'ready' ? <><Check aria-hidden="true" className="size-4 text-brand-blue" /><span className="sr-only">已就绪</span></> : step.status === 'running' ? <><Loader2 aria-hidden="true" className="size-3.5 animate-spin" />准备中</> : step.status === 'failed' ? <><CircleAlert aria-hidden="true" className="size-4 text-status-danger-fg" /><span className="sr-only">失败</span></> : '待准备')}</span></div>)}</>
}
const icons = { whisper: AudioLines, voxcpm: Mic2, demucs: Waves, qwen: SlidersHorizontal }
export function ModelDownloadRow({ model, action }: { model: SetupModel; action?: ReactNode }) {
  const done = model.status === 'ready'
  const Icon = icons[model.id as keyof typeof icons] || AudioLines
  return <div className="flex items-center gap-3 py-5 sm:gap-4">
    <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent', done ? 'text-brand-blue' : 'text-brand-pink')}><Icon className="size-4.5" /></span>
    <div className="min-w-0 flex-1 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 truncate text-sm font-medium" title={`${model.name} ${model.variant}`}>{model.name}{model.variant && <span className="ml-1.5 text-[11px] font-normal text-subtle-foreground">{model.variant}</span>}</span>
        <span className="flex-1 whitespace-nowrap text-xs text-muted-foreground">{model.purpose}</span>
        <span className={cn('shrink-0 text-xs tabular-nums', done ? 'text-status-success-fg' : model.status === 'failed' ? 'text-status-danger-fg' : model.status === 'downloading' ? 'text-status-running-fg' : 'text-muted-foreground')}>
          {done ? '已下载' : model.status === 'failed' ? '失败' : model.status === 'pending' ? '待下载' : model.status === 'paused' ? '已暂停' : <><span className="mr-2 hidden sm:inline">{sizeLabel(model.speed)}/s</span>{model.total ? Math.floor(model.received / model.total * 100) : 0}%</>}
        </span>
        {action}
      </div>
      <div className="flex items-center gap-3">{model.source && !done && <span className="text-[11px] text-subtle-foreground">{model.source}</span>}<div className="min-w-0 flex-1"><ResourceProgress value={model.total ? model.received / model.total : 0} label={`${model.name} 下载进度`} paused={model.status === 'paused'} /></div><span className="shrink-0 text-[11px] tabular-nums text-subtle-foreground">{sizeLabel(model.received)} / {sizeLabel(model.total)}</span></div>
    </div>
  </div>
}
