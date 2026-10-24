'use client'

import { type ReactNode } from 'react'
import { ArrowDownToLine, Check, CircleAlert, Cpu, Loader2, Pause, RotateCcw } from '@/lib/icons'
import { Button } from '@/components/ui/button'
import { useText } from '@/lib/i18n'
import { SetupInstallation } from './setup-installation'
import { SetupDiagnostics } from './setup-diagnostics'
import { SetupActivity } from './setup-activity'
import { SetupPage } from './setup-page'
import { Progress } from './ui/progress'
import { sizeLabel } from '@/lib/format'
import { setupResourceEntries, type ResourceSelection, type SetupAction, type SetupState } from '@/runtime/setup-contracts'
export type { SetupAction, SetupModel, SetupState } from '@/runtime/setup-contracts'

import { ResourceRow } from './resource-row'
import { Surface } from './ui/surface'

export interface SetupScreenOptions {
  wordmarkSrc?: string
  themeControl?: ReactNode
  pickDirectory?: () => Promise<string | null>
  className?: string
}

export function SetupScreen({ state, busy = false, onAction, onPrepare, onConfigure, pickDirectory, onReset, wordmarkSrc, themeControl, className = 'min-h-screen' }: {
  state: SetupState; busy?: boolean; onConfigure?: (path: string) => Promise<void>; onAction: (action: SetupAction, id?: string) => void; onReset?: () => void; onPrepare?: (selections: ResourceSelection[]) => void
} & SetupScreenOptions) {
  const text = useText()
  const environment = state.resources?.environment ?? state.environment
  const currentStep = environment.find(step => step.status === 'running')
  const entries = setupResourceEntries(state)
  const selection = state.resourceSelection
  const awaitingPreparation = selection?.required === true
  const requiredResources = selection?.items.filter(item => item.downloadId).map(({ providerId, model }) => ({ providerId, ...(model ? { model } : {}) })) ?? []
  const total = state.models.reduce((sum, model) => sum + model.total, 0)
  const totalKnown = state.models.length > 0 && state.models.every(model => model.total > 0)
  const received = state.models.reduce((sum, model) => sum + model.received, 0)
  const speed = state.models.reduce((sum, model) => sum + model.speed, 0)
  const active = state.models.filter(model => model.status === 'downloading').length
  const downloaded = state.models.filter(model => model.status === 'ready').length
  const complete = entries.filter(entry => entry.group === 'model' && entry.status === 'ready').length
  const environmentReady = environment.length > 0 && environment.every(step => step.status === 'ready')
  const showModels = environmentReady && state.models.length > 0 && !['starting', 'environment'].includes(state.phase)
  const showDownloadProgress = received > 0 || active > 0
  const failed = state.models.some(model => model.status === 'failed')
  const allReady = environmentReady && state.models.length > 0 && complete === state.models.length
  const verifying = state.phase === 'starting' || state.resources?.status === 'preparing' && state.models.length > 0 && downloaded === state.models.length && environmentReady
  const platform = ({ darwin: 'macOS', win32: 'Windows', linux: 'Linux' } as Record<string, string>)[state.platform] || state.platform
  const arch = state.platform === 'darwin' && state.arch === 'arm64' ? 'Apple Silicon' : state.arch
  const showTransfer = !awaitingPreparation && showModels && showDownloadProgress
  const stageAction = verifying ? <Loader2 aria-label={text('setup.verifying')} className="size-5 animate-spin text-status-running-fg" />
    : awaitingPreparation ? null
    : state.phase === 'failed' ? state.canRetry && <Button disabled={busy} onClick={() => onAction('retry')}><RotateCcw />{text('resource.action.retry')}</Button>
    : showModels && state.phase === 'models' ? <Button variant="outline" size="lg" disabled={busy || (!active && !failed && !entries.some(entry => entry.status === 'paused'))} onClick={() => onAction(active ? 'pause' : failed ? 'retry' : 'resume')}>{active ? <Pause /> : failed ? <RotateCcw /> : <ArrowDownToLine />}{active ? text('setup.pauseAll') : failed ? text('resource.action.retry') : text('resource.action.resume')}</Button>
    : state.phase === 'starting' && <Loader2 aria-label={text('setup.starting')} className="size-5 animate-spin text-status-running-fg" />
  return <SetupPage wordmarkSrc={wordmarkSrc} className={className} actions={<>
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><Cpu className="size-3.5 shrink-0" />{platform} · {arch}</span>
      {onReset && <Button variant="ghost" size="icon-sm" aria-label={text('setup.reset')} title={text('setup.reset')} onClick={onReset}><RotateCcw /></Button>}
      {themeControl}
    </>}>
      {state.phase === 'installation' && state.installation && onConfigure ? <SetupInstallation path={state.installation.path} busy={busy} configure={onConfigure} pickDirectory={pickDirectory} /> : <>
      <div className="flex min-w-0 flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="flex items-center gap-3 text-base font-medium">
        {state.phase === 'failed' ? <CircleAlert className="size-4 text-status-danger-fg" /> : currentStep || active || verifying ? <Loader2 className="size-4 animate-spin text-status-running-fg" /> : null}
        {text(showModels ? 'setup.models' : 'setup.environment')}
      </h1>
      {awaitingPreparation && <Button disabled={busy || state.phase !== 'models' || !requiredResources.length || !onPrepare} onClick={() => onPrepare?.(requiredResources)}>{allReady ? <Check /> : <ArrowDownToLine />}{text(allReady ? 'setup.openWorkbench' : showModels ? 'setup.prepareAll' : 'setup.startPreparation')}</Button>}
      </div>
      <div className="flex min-w-0 flex-col gap-4">
      <SetupActivity key={showModels ? 'models' : 'environment'} state={state} stage={showModels ? 'models' : 'environment'} />
      {state.phase !== 'starting' && <>
      {(!environmentReady || !state.models.length) && <Surface aria-label={text('setup.environment')} className="divide-y divide-border px-4">
        {environment.length > 0 && <div className="space-y-2 py-4">
          <div className="text-xs tabular-nums">{text('setup.environmentCompleted', { complete: environment.filter(step => step.status === 'ready').length, total: environment.length })}</div>
          <Progress value={environment.filter(step => step.status === 'ready').length / environment.length} label={text('setup.environmentProgress')} />
        </div>}
        {entries.filter(entry => entry.group === 'environment').map(entry => <ResourceRow key={entry.id} entry={entry} busy={busy} onAction={state.phase === 'failed' && state.canRetry ? () => onAction('retry') : undefined} />)}
      </Surface>}
      {environmentReady && state.environment.find(step => step.id === 'acceleration')?.detail && <p className="text-xs text-muted-foreground">{state.environment.find(step => step.id === 'acceleration')!.detail}</p>}
      {showModels && <Surface aria-label={text('setup.models')} className="overflow-hidden">
        <div className="space-y-4 border-b border-border bg-muted p-4">
          {awaitingPreparation ? <div className="flex flex-wrap items-center justify-between gap-3 text-sm"><span className="font-medium">{text('setup.required')}</span><span role="status" aria-label={text('setup.totalSize')} className="text-xs tabular-nums text-muted-foreground">{text('setup.modelCount', { count: state.models.length, size: sizeLabel(total) })}</span></div> : <><div className="flex flex-wrap items-center justify-between gap-3 text-xs tabular-nums">
            <span className="font-medium">{verifying ? text('setup.verifying') : state.phase === 'ready' ? text('setup.allReady') : active ? text('setup.downloading', { count: active }) : failed ? text('setup.downloadFailed') : entries.some(entry => entry.status === 'paused') ? text('resource.status.paused') : !environmentReady ? text('setup.waiting') : text('resource.status.preparing')}</span>
            <span className="text-muted-foreground">{text('setup.completed', { complete, total: state.models.length })}{showDownloadProgress && totalKnown && <span className="ml-3 text-lg font-medium text-foreground">{Math.floor(received / total * 100)}%</span>}</span>
          </div>
          {showDownloadProgress && <Progress value={totalKnown ? received / total : undefined} label={text('setup.progress')} paused={!active} />}</>}
        </div>
        <div className="divide-y divide-border px-4">
          {entries.filter(entry => entry.group === 'model').map(entry => <ResourceRow key={entry.id} entry={entry} busy={busy} onAction={awaitingPreparation ? undefined : (action, resource) => onAction(action === 'prepare' ? 'resume' : action, resource.downloadId)} />)}


        </div>
      </Surface>}
      </>}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <a href="https://liuzhao1225.github.io/YouDub-webui/#demo" target="_blank" rel="noopener noreferrer" className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">{text('setup.examples')}</a>
        {(showTransfer || stageAction) && <div className="ml-auto flex flex-wrap items-center justify-end gap-3">
          {showTransfer && <span className="text-xs tabular-nums text-muted-foreground">{sizeLabel(received)}{totalKnown && <> / {sizeLabel(total)}</>}{speed > 0 && <span className="ml-3 text-subtle-foreground">{sizeLabel(speed)}/s</span>}</span>}
          {stageAction}
        </div>}
      </div>
      </div>
      <SetupDiagnostics state={state} />
      </>}
  </SetupPage>
}
