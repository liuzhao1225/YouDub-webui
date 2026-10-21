'use client'

import { type ReactNode, useState } from 'react'
import { ArrowDownToLine, Check, CircleAlert, Cpu, Loader2, Moon, Pause, Play, RotateCcw, Sun } from 'lucide-react'
import { BrandMark } from '@/components/brand/brand-mark'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useText } from '@/lib/i18n'
import { SetupDiagnostics } from './setup-diagnostics'
import { PageContainer } from './page-layout'
import { EnvironmentSteps, ModelDownloadRow, ResourceProgress as Progress, sizeLabel } from './setup-resources'
export { sizeLabel } from './setup-resources'
import type { ResourceSelection, SetupAction, SetupState } from '@/runtime/setup-contracts'
export type { SetupAction, SetupModel, SetupState } from '@/runtime/setup-contracts'

export interface SetupScreenOptions {
  wordmarkSrc?: string
  themeControl?: ReactNode
  examplesHref?: string
  onOpenExamples?: () => void
  className?: string
}

export function SetupScreen({ state, busy = false, onAction, onPrepare, onReset, wordmarkSrc, themeControl, examplesHref = '/examples/index.html', onOpenExamples, className = 'min-h-screen' }: {
  state: SetupState; busy?: boolean; onAction: (action: SetupAction, id?: string) => void; onReset?: () => void; onPrepare?: (selections: ResourceSelection[]) => void
} & SetupScreenOptions) {
  const text = useText()
  const [light, setLight] = useState(false)
  const selection = state.resourceSelection
  const awaitingPreparation = selection?.required === true
  const requiredResources = selection?.items.filter(item => item.downloadId).map(({ providerId, model }) => ({ providerId, ...(model ? { model } : {}) })) ?? []
  const total = state.models.reduce((sum, model) => sum + model.total, 0)
  const received = state.models.reduce((sum, model) => sum + model.received, 0)
  const speed = state.models.reduce((sum, model) => sum + model.speed, 0)
  const active = state.models.filter(model => model.status === 'downloading').length
  const complete = state.models.filter(model => model.status === 'ready').length
  const failed = state.models.some(model => model.status === 'failed')
  const environmentReady = state.environment.every(step => step.status === 'ready')
  const verifying = state.phase === 'starting' || state.resources?.status === 'preparing' && state.models.length > 0 && complete === state.models.length && environmentReady
  const platform = ({ darwin: 'macOS', win32: 'Windows', linux: 'Linux' } as Record<string, string>)[state.platform] || state.platform
  const arch = state.platform === 'darwin' && state.arch === 'arm64' ? 'Apple Silicon' : state.arch
  return <div className={className}>
    <PageContainer as="header" className="flex items-center justify-between py-6">
      <span aria-label="YouDub"><BrandMark animated wordmark wordmarkSrc={wordmarkSrc} className="h-7" /></span>
      <div className="flex items-center gap-2">
        <span className="mr-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground"><Cpu className="size-3.5" />{platform} · {arch}</span>
        {onReset && <Button variant="ghost" size="icon-sm" aria-label={text('setup.reset')} title={text('setup.reset')} onClick={onReset}><RotateCcw /></Button>}
        {themeControl ?? <Button variant="ghost" size="icon-sm" aria-label={light ? text('nav.switchToDark') : text('nav.switchToLight')} onClick={() => { setLight(!light); document.documentElement.classList.toggle('dark', light) }}>{light ? <Moon /> : <Sun />}</Button>}
      </div>
    </PageContainer>
    <PageContainer as="main" className="max-w-3xl py-8 sm:py-12">
      <h1 className="mb-6 flex items-center gap-3 text-base font-medium">
        <span className={cn('inline-flex items-center gap-2', environmentReady && 'text-muted-foreground')}>{environmentReady ? <Check className="size-4 text-brand-blue" /> : state.phase === 'failed' ? <CircleAlert className="size-4 text-status-danger-fg" /> : <Loader2 className="size-4 animate-spin text-brand-pink" />}{text('setup.environment')}</span>
        {state.models.length > 0 && <><span className="text-subtle-foreground">/</span><span className={cn('inline-flex items-center gap-2', !environmentReady && 'text-muted-foreground')}>{state.phase === 'ready' && <Check className="size-4 text-brand-blue" />}{text('setup.models')}</span></>}
      </h1>
      {(!environmentReady || !state.models.length) && <section aria-label={text('setup.environment')} className="mb-5 divide-y divide-border rounded-2xl border border-border bg-card px-5 shadow-card">
        <EnvironmentSteps steps={state.environment} />
      </section>}
      {environmentReady && state.environment.find(step => step.id === 'acceleration')?.detail && <p className="mb-5 text-xs text-muted-foreground">{state.environment.find(step => step.id === 'acceleration')!.detail}</p>}
      {state.models.length > 0 && <section aria-label={text('setup.downloads')} className="overflow-hidden rounded-2xl border border-border bg-card shadow-card">
        <div className="space-y-4 border-b border-border bg-muted p-5">
          {awaitingPreparation ? <div className="flex items-center justify-between gap-3 text-sm"><span className="font-medium">{text('setup.required')}</span><span role="status" aria-label={text('setup.totalSize')} className="text-xs tabular-nums text-muted-foreground">{text('setup.modelCount', { count: state.models.length, size: sizeLabel(total) })}</span></div> : <><div className="flex items-center justify-between gap-3 text-xs tabular-nums">
            <span className="font-medium">{verifying ? text('setup.verifying') : state.phase === 'ready' ? text('setup.allReady') : active ? text('setup.downloading', { count: active }) : failed ? text('setup.downloadFailed') : !environmentReady ? text('setup.waiting') : text('setup.paused')}</span>
            <span className="text-muted-foreground">{text('setup.completed', { complete, total: state.models.length })}<span className="ml-3 text-lg font-medium text-foreground">{total ? Math.floor(received / total * 100) : 0}%</span></span>
          </div>
          <Progress value={total ? received / total : 0} label={text('setup.progress')} paused={!active} /></>}
        </div>
        <div className="divide-y divide-border px-5">
          {state.models.map(model => <ModelDownloadRow key={model.id} model={model} action={model.status === 'ready'
            ? <span className="flex size-7 shrink-0 items-center justify-center"><Check className="size-4 text-brand-blue" /></span>
            : awaitingPreparation ? undefined : <Button variant="ghost" size="icon-xs" disabled={busy || state.phase !== 'models' || model.status === 'pending'} aria-label={`${model.status === 'downloading' ? text('setup.pause') : model.status === 'failed' ? text('setup.retry') : text('setup.resume')} ${model.name}`} onClick={() => onAction(model.status === 'downloading' ? 'pause' : model.status === 'failed' ? 'retry' : 'resume', model.id)}>{model.status === 'downloading' ? <Pause /> : model.status === 'failed' ? <RotateCcw /> : <Play />}</Button>} />)}

        </div>
      </section>}
      <SetupDiagnostics state={state} />
      <div className="mt-5"><a href={examplesHref} onClick={onOpenExamples ? (event) => { if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); onOpenExamples() } } : undefined} className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">{text('setup.examples')}</a></div>
      <div className="mt-5 flex items-center justify-between gap-3">
        <span className="text-xs tabular-nums text-muted-foreground">{awaitingPreparation ? null : state.models.length ? <>{sizeLabel(received)} / {sizeLabel(total)}{speed > 0 && <span className="ml-3 text-subtle-foreground">{sizeLabel(speed)}/s</span>}</> : state.phase === 'starting' ? text('setup.opening') : ''}</span>
        {verifying ? <Loader2 aria-label={text('setup.verifying')} className="size-5 animate-spin text-brand-pink" /> : awaitingPreparation ? <Button size="lg" disabled={busy || state.phase !== 'models' || !requiredResources.length || !onPrepare} onClick={() => onPrepare?.(requiredResources)}><ArrowDownToLine />{text('setup.prepareAll')}</Button> : state.phase === 'failed' ? state.canRetry && <Button disabled={busy} onClick={() => onAction('retry')}><RotateCcw />{text('setup.prepareAgain')}</Button> : state.phase === 'models' ? <Button variant="outline" size="lg" disabled={busy} onClick={() => onAction(active ? 'pause' : failed ? 'retry' : 'resume')}>{active ? <Pause /> : failed ? <RotateCcw /> : <ArrowDownToLine />}{active ? text('setup.pauseAll') : failed ? text('setup.retryDownloads') : text('setup.resumeDownloads')}</Button> : state.phase === 'starting' && <Loader2 aria-label={text('setup.starting')} className="size-5 animate-spin text-brand-pink" />}
      </div>
    </PageContainer>
  </div>
}
