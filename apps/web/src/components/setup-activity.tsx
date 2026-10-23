'use client'

import { useEffect, useRef, useState } from 'react'
import { ArrowDownToLine, CircleAlert, Loader2 } from '@/lib/icons'
import { useText } from '@/lib/i18n'
import { redactDiagnostics } from '@/lib/setup-diagnostics'
import type { SetupState } from '@/runtime/setup-contracts'
import { Button } from './ui/button'
import { Surface } from './ui/surface'
import { sizeLabel } from './setup-resources'

/** The same installer output as the diagnostic report, visible without opening it. */
export function SetupActivity({ state }: { state: SetupState }) {
  const text = useText()
  const environment = state.resources?.environment ?? state.environment
  const models = state.resources?.models ?? state.models
  const current = environment.find(step => step.status === 'running')
  const downloads = models.filter(model => model.status === 'downloading')
  const failed = state.phase === 'failed' || state.resources?.status === 'failed'
  const running = !failed && Boolean(current || downloads.length || state.phase === 'starting')
  const output = [...environment, ...models].flatMap(item => item.log ? [`[${item.name}]\n${item.log.trimEnd()}`] : [])
  const errors = [...new Set([state.error, state.resources?.error, ...environment.filter(step => step.status === 'failed').map(step => step.detail), ...models.map(model => model.error)].filter(Boolean))]
  const log = redactDiagnostics([...output, ...errors.filter(error => !output.some(chunk => chunk.includes(error!)))].join('\n\n'), state.token, state.homeDir)
  const viewport = useRef<HTMLPreElement>(null)
  const [following, setFollowing] = useState(true)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!running || !current?.startedAt) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [running, current?.startedAt])
  useEffect(() => {
    if (following && viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight
  }, [log, following])
  if (!log && !running) return null
  const activity = failed ? text('setup.preparationFailed') : current?.activity || current?.name || (downloads.length ? text('setup.downloading', { count: downloads.length }) : state.phase === 'starting' ? text('setup.verifying') : '')
  return <Surface aria-label={text('setup.liveLogs')} className="mb-4 overflow-hidden">
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
      <h2 className="text-sm font-medium">{text('setup.liveLogs')}</h2>
      {!following && <Button variant="ghost" size="sm" onClick={() => setFollowing(true)}><ArrowDownToLine />{text('setup.followLogs')}</Button>}
    </div>
    {activity && <p role="status" className={`flex items-start gap-2 px-4 pt-3 text-xs ${failed ? 'text-status-danger-fg' : 'text-foreground'}`}>
      {running ? <Loader2 aria-hidden="true" className="size-3.5 shrink-0 animate-spin motion-reduce:animate-none" /> : failed ? <CircleAlert aria-hidden="true" className="size-3.5 shrink-0" /> : null}
      <span className="min-w-0 break-words">{redactDiagnostics(activity, state.token, state.homeDir)}</span>
    </p>}
    <pre ref={viewport} role="log" aria-label={text('setup.liveLogs')} aria-live="off" tabIndex={0}
      onScroll={event => { const node = event.currentTarget; setFollowing(node.scrollHeight - node.scrollTop - node.clientHeight <= 1) }}
      className="m-0 h-48 overflow-auto whitespace-pre-wrap break-words px-4 py-3 font-mono text-xs leading-relaxed text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:-outline-offset-2 sm:h-56">{log || text('setup.waitingForOutput')}</pre>
    {(running && current?.startedAt || downloads.length > 0) && <div className="flex flex-wrap justify-between gap-2 border-t border-border px-4 py-2 text-xs tabular-nums text-muted-foreground">
      {running && current?.startedAt && <><span>{text('setup.elapsed', { seconds: Math.max(0, Math.floor((now - current.startedAt) / 1000)) })}</span>{current.updatedAt && <span>{text('setup.lastOutput', { seconds: Math.max(0, Math.floor((now - current.updatedAt) / 1000)) })}</span>}</>}
      {downloads.map(model => <span key={model.id}>{model.name} · {sizeLabel(model.received)}{model.total > 0 && ` / ${sizeLabel(model.total)}`}{model.speed > 0 && ` · ${sizeLabel(model.speed)}/s`}</span>)}
    </div>}
  </Surface>
}
