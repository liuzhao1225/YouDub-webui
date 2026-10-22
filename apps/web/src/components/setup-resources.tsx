import type { ReactNode } from 'react'
import { AudioLines, Check, CircleAlert, Loader2, Mic2, SlidersHorizontal, Waves } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { useText } from '@/lib/i18n'
import type { MessageKey } from '@/locales'
import type { EnvironmentStep, SetupModel } from '@/runtime/setup-contracts'

const environmentNames: Partial<Record<string, MessageKey>> = { dependencies: 'setup.dependencies', acceleration: 'setup.acceleration', resources: 'setup.resources' }
const modelPurposes: Partial<Record<string, MessageKey>> = { whisper: 'setup.whisper', voxcpm: 'setup.voxcpm', demucs: 'setup.demucs', qwen: 'setup.qwen' }

export function sizeLabel(bytes: number) {
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(2)} GB` : bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : bytes >= 1000 ? `${Math.round(bytes / 1000)} KB` : `${Math.round(bytes)} B`
}
export function ResourceProgress({ value, label, paused = false }: { value: number; label: string; paused?: boolean }) {
  const percent = Math.floor(Math.min(1, value) * 100)
  return <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="h-1.5 overflow-hidden rounded-full bg-accent">
    <div className={cn('h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none', value >= 1 ? 'bg-brand-blue' : paused ? 'bg-subtle-foreground' : 'bg-brand-gradient')} style={{ width: `${percent}%` }} />
  </div>
}
export function EnvironmentSteps({ steps, actions }: { steps: EnvironmentStep[]; actions?: Record<string, ReactNode> }) {
  const text = useText()
  return <>{steps.map(step => <div key={step.id} className="flex flex-wrap items-center justify-between gap-3 py-4 text-sm"><div><span>{environmentNames[step.id] ? text(environmentNames[step.id]!) : step.name}</span>{step.source && <span className="ml-2 text-xs text-subtle-foreground">{step.source}</span>}{step.detail && <p className="mt-1 break-words text-xs text-muted-foreground">{step.detail}</p>}</div><span className="inline-flex shrink-0 items-center gap-2 text-xs text-muted-foreground">{actions?.[step.id] || (step.status === 'ready' ? <><Check aria-hidden="true" className="size-4 text-link" /><span className="sr-only">{text('setup.ready')}</span></> : step.status === 'running' ? <><Loader2 aria-hidden="true" className="size-3.5 animate-spin" />{text('setup.preparing')}</> : step.status === 'failed' ? <><CircleAlert aria-hidden="true" className="size-4 text-status-danger-fg" /><span className="sr-only">{text('setup.failed')}</span></> : text('setup.pending'))}</span>{step.phase === 'downloading' && step.progress && step.progress.total > 0 && <div className="w-full space-y-1"><ResourceProgress value={step.progress.received / step.progress.total} label={text('setup.currentDownload')} /><p className="text-xs tabular-nums text-muted-foreground">{sizeLabel(step.progress.received)} / {sizeLabel(step.progress.total)}{Boolean(step.progress.speed) && <> · {sizeLabel(step.progress.speed!)}/s</>}</p></div>}</div>)}</>
}
const icons = { whisper: AudioLines, voxcpm: Mic2, demucs: Waves, qwen: SlidersHorizontal }
export function ModelDownloadRow({ model, action }: { model: SetupModel; action?: ReactNode }) {
  const text = useText()
  const purposeKey = modelPurposes[model.id]
  const done = model.status === 'ready'
  const Icon = icons[model.id as keyof typeof icons] || AudioLines
  return <div className="flex items-center gap-3 py-4 sm:gap-4">
    <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent', done ? 'text-link' : 'text-status-running-fg')}><Icon className="size-4.5" /></span>
    <div className="min-w-0 flex-1 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 truncate text-sm font-medium" title={`${model.name} ${model.variant}`}>{model.name}{model.variant && <span className="ml-1.5 text-[11px] font-normal text-subtle-foreground">{model.variant}</span>}</span>
        <span className="flex-1 whitespace-nowrap text-xs text-muted-foreground">{purposeKey ? text(purposeKey) : model.purpose}</span>
        <span className={cn('shrink-0 text-xs tabular-nums', done ? 'text-status-success-fg' : model.status === 'failed' ? 'text-status-danger-fg' : model.status === 'downloading' ? 'text-status-running-fg' : 'text-muted-foreground')}>
          {done ? text('setup.downloaded') : model.status === 'failed' ? text('setup.failed') : model.status === 'pending' ? text('setup.pendingDownload') : model.status === 'paused' ? text('setup.modelPaused') : <><span className="mr-2 hidden sm:inline">{sizeLabel(model.speed)}/s</span>{model.total ? Math.floor(model.received / model.total * 100) : 0}%</>}
        </span>
        {action}
      </div>
      <div className="flex items-center gap-3">{model.source && !done && <span className="text-[11px] text-subtle-foreground">{model.source}</span>}<div className="min-w-0 flex-1"><ResourceProgress value={model.total ? model.received / model.total : 0} label={text('setup.modelProgress', { model: model.name })} paused={model.status === 'paused'} /></div><span className="shrink-0 text-[11px] tabular-nums text-subtle-foreground">{sizeLabel(model.received)} / {sizeLabel(model.total)}</span></div>
    </div>
  </div>
}
