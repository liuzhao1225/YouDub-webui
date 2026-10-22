'use client'

import { type ReactNode, useEffect, useState } from 'react'
import { ArrowDownToLine, Check, CircleAlert, Cpu, Loader2, Moon, Pause, RotateCcw, Sun } from '@/lib/icons'
import { BrandMark } from '@/components/brand/brand-mark'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useText } from '@/lib/i18n'
import { SetupInstallation } from './setup-installation'
import { SetupDiagnostics } from './setup-diagnostics'
import { PageContainer } from './page-layout'
import { ResourceProgress as Progress, sizeLabel } from './setup-resources'
export { sizeLabel } from './setup-resources'
import { setupResourceEntries, type ResourceSelection, type SetupAction, type SetupState } from '@/runtime/setup-contracts'
export type { SetupAction, SetupModel, SetupState } from '@/runtime/setup-contracts'

import { ResourceRow } from './resource-row'
import { Surface } from './ui/surface'

export interface SetupScreenOptions {
  wordmarkSrc?: string
  themeControl?: ReactNode
  examplesHref?: string
  onOpenExamples?: () => void
  pickDirectory?: () => Promise<string | null>
  className?: string
}

export function SetupScreen({ state, busy = false, onAction, onPrepare, onConfigure, pickDirectory, onReset, wordmarkSrc, themeControl, examplesHref = '/examples/index.html', onOpenExamples, className = 'min-h-screen' }: {
  state: SetupState; busy?: boolean; onConfigure?: (path: string) => Promise<void>; onAction: (action: SetupAction, id?: string) => void; onReset?: () => void; onPrepare?: (selections: ResourceSelection[]) => void
} & SetupScreenOptions) {
  const text = useText()
  const [light, setLight] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const environment = state.resources?.environment ?? state.environment
  const currentStep = environment.find(step => step.status === 'running')
  const startedAt = currentStep?.startedAt
  useEffect(() => {
    if (!startedAt) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [startedAt])
  const entries = setupResourceEntries(state)
  const selection = state.resourceSelection
  const awaitingPreparation = selection?.required === true
  const requiredResources = selection?.items.filter(item => item.downloadId).map(({ providerId, model }) => ({ providerId, ...(model ? { model } : {}) })) ?? []
  const total = state.models.reduce((sum, model) => sum + model.total, 0)
  const received = state.models.reduce((sum, model) => sum + model.received, 0)
  const speed = state.models.reduce((sum, model) => sum + model.speed, 0)
  const active = state.models.filter(model => model.status === 'downloading').length
  const downloaded = state.models.filter(model => model.status === 'ready').length
  const complete = entries.filter(entry => entry.group === 'model' && entry.status === 'ready').length
  const showModels = state.models.length > 0 && (state.phase !== 'environment' || Boolean(state.resources))
  const showDownloadProgress = received > 0 || active > 0
  const failed = state.models.some(model => model.status === 'failed')
  const environmentReady = state.environment.length > 0 && state.environment.every(step => step.status === 'ready')
  const allReady = environmentReady && state.models.length > 0 && complete === state.models.length
  const verifying = state.phase === 'starting' || state.resources?.status === 'preparing' && state.models.length > 0 && downloaded === state.models.length && environmentReady
  const platform = ({ darwin: 'macOS', win32: 'Windows', linux: 'Linux' } as Record<string, string>)[state.platform] || state.platform
  const arch = state.platform === 'darwin' && state.arch === 'arm64' ? 'Apple Silicon' : state.arch
  return <div className={className}>
    <PageContainer as="header" className="flex items-center justify-between py-[var(--page-top)]">
      <span aria-label="YouDub"><BrandMark animated wordmark wordmarkSrc={wordmarkSrc} className="h-7" /></span>
      <div className="flex items-center gap-2">
        <span className="mr-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground"><Cpu className="size-3.5" />{platform} · {arch}</span>
        {onReset && <Button variant="ghost" size="icon-sm" aria-label={text('setup.reset')} title={text('setup.reset')} onClick={onReset}><RotateCcw /></Button>}
        {themeControl ?? <Button variant="ghost" size="icon-sm" aria-label={light ? text('nav.switchToDark') : text('nav.switchToLight')} onClick={() => { setLight(!light); document.documentElement.classList.toggle('dark', light) }}>{light ? <Moon /> : <Sun />}</Button>}
      </div>
    </PageContainer>
    <PageContainer as="main" className="max-w-3xl pb-12">
      {state.phase === 'installation' && state.installation && onConfigure ? <SetupInstallation path={state.installation.path} busy={busy} configure={onConfigure} pickDirectory={pickDirectory} /> : <>
      {state.phase === 'starting' ? <p role="status" className="text-sm text-muted-foreground">{text('setup.verifying')}</p> : <>
      <h1 className="mb-6 flex items-center gap-3 text-base font-medium">
        <span className={cn('inline-flex items-center gap-2', environmentReady && 'text-muted-foreground')}>{environmentReady ? <Check className="size-4 text-link" /> : state.phase === 'failed' ? <CircleAlert className="size-4 text-status-danger-fg" /> : <Loader2 className="size-4 animate-spin text-status-running-fg" />}{text('setup.environment')}</span>
        {showModels && <><span className="text-subtle-foreground">/</span><span className={cn('inline-flex items-center gap-2', !environmentReady && 'text-muted-foreground')}>{state.phase === 'ready' && <Check className="size-4 text-link" />}{text('setup.models')}</span></>}
      </h1>
      {(!environmentReady || !state.models.length) && <Surface aria-label={text('setup.environment')} className="mb-4 divide-y divide-border px-4">
        {environment.length > 0 && <div className="space-y-2 py-4">
          <div className="flex flex-wrap justify-between gap-2 text-xs tabular-nums"><span>{text('setup.environmentCompleted', { complete: environment.filter(step => step.status === 'ready').length, total: environment.length })}</span>{startedAt && <span className="text-muted-foreground">{text('setup.elapsed', { seconds: Math.max(0, Math.floor((now - startedAt) / 1000)) })}{currentStep.updatedAt && <> · {text('setup.lastOutput', { seconds: Math.max(0, Math.floor((now - currentStep.updatedAt) / 1000)) })}</>}</span>}</div>
          <Progress value={environment.filter(step => step.status === 'ready').length / environment.length} label={text('setup.environmentProgress')} />
          {currentStep?.activity && <p className="break-all text-xs text-muted-foreground">{currentStep.activity}</p>}
          {currentStep?.source && <p className="text-xs text-muted-foreground">{currentStep.source}</p>}

        </div>}
        {entries.filter(entry => entry.group === 'environment').map(entry => <ResourceRow key={entry.id} entry={entry} busy={busy} onAction={state.phase === 'failed' && state.canRetry ? () => onAction('retry') : undefined} />)}
      </Surface>}
      {environmentReady && state.environment.find(step => step.id === 'acceleration')?.detail && <p className="mb-4 text-xs text-muted-foreground">{state.environment.find(step => step.id === 'acceleration')!.detail}</p>}
      {showModels && <Surface aria-label={text('setup.models')} className="overflow-hidden">
        <div className="space-y-4 border-b border-border bg-muted p-4">
          {awaitingPreparation ? <div className="flex items-center justify-between gap-3 text-sm"><span className="font-medium">{text('setup.required')}</span><span role="status" aria-label={text('setup.totalSize')} className="text-xs tabular-nums text-muted-foreground">{text('setup.modelCount', { count: state.models.length, size: sizeLabel(total) })}</span></div> : <><div className="flex items-center justify-between gap-3 text-xs tabular-nums">
            <span className="font-medium">{verifying ? text('setup.verifying') : state.phase === 'ready' ? text('setup.allReady') : active ? text('setup.downloading', { count: active }) : failed ? text('setup.downloadFailed') : entries.some(entry => entry.status === 'paused') ? text('resource.status.paused') : !environmentReady ? text('setup.waiting') : text('resource.status.preparing')}</span>
            <span className="text-muted-foreground">{text('setup.completed', { complete, total: state.models.length })}{showDownloadProgress && <span className="ml-3 text-lg font-medium text-foreground">{total ? Math.floor(received / total * 100) : 0}%</span>}</span>
          </div>
          {showDownloadProgress && <Progress value={total ? received / total : 0} label={text('setup.progress')} paused={!active} />}</>}
        </div>
        <div className="divide-y divide-border px-4">
          {entries.filter(entry => entry.group === 'model').map(entry => <ResourceRow key={entry.id} entry={entry} busy={busy} onAction={awaitingPreparation ? undefined : (action, resource) => onAction(action === 'prepare' ? 'resume' : action, resource.downloadId)} />)}


        </div>
      </Surface>}
      </>}
      <div className="mt-4"><a href={examplesHref} onClick={onOpenExamples ? (event) => { if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); onOpenExamples() } } : undefined} className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">{text('setup.examples')}</a></div>
      <div className="mt-4 flex items-center justify-between gap-3">
        <span className="text-xs tabular-nums text-muted-foreground">{awaitingPreparation || state.phase === 'starting' || !showDownloadProgress ? null : state.models.length ? <>{sizeLabel(received)} / {sizeLabel(total)}{speed > 0 && <span className="ml-3 text-subtle-foreground">{sizeLabel(speed)}/s</span>}</> : ''}</span>
        {verifying ? <Loader2 aria-label={text('setup.verifying')} className="size-5 animate-spin text-status-running-fg" /> : awaitingPreparation ? <Button size="lg" disabled={busy || state.phase !== 'models' || !requiredResources.length || !onPrepare} onClick={() => onPrepare?.(requiredResources)}>{allReady ? <Check /> : <ArrowDownToLine />}{text(allReady ? 'setup.openWorkbench' : 'setup.prepareAll')}</Button> : state.phase === 'failed' ? state.canRetry && <Button disabled={busy} onClick={() => onAction('retry')}><RotateCcw />{text('resource.action.retry')}</Button> : state.phase === 'models' ? <Button variant="outline" size="lg" disabled={busy || (!active && !failed && !entries.some(entry => entry.status === 'paused'))} onClick={() => onAction(active ? 'pause' : failed ? 'retry' : 'resume')}>{active ? <Pause /> : failed ? <RotateCcw /> : <ArrowDownToLine />}{active ? text('setup.pauseAll') : failed ? text('resource.action.retry') : text('resource.action.resume')}</Button> : state.phase === 'starting' && <Loader2 aria-label={text('setup.starting')} className="size-5 animate-spin text-status-running-fg" />}
      </div>
      <SetupDiagnostics state={state} />
      </>}
    </PageContainer>
  </div>
}
