import { Textarea } from '@/components/ui/textarea'
'use client'

import { copyText } from '@/lib/clipboard'
import { useEffect, useRef, useState } from 'react'
import { Check, Copy, ExternalLink } from '@/lib/icons'
import { Button, buttonVariants } from '@/components/ui/button'
import { setupIssue, setupReport } from '@/lib/setup-diagnostics'
import { cn } from '@/lib/utils'
import { useText } from '@/lib/i18n'
import type { SetupState } from '@/runtime/setup-contracts'

export function SetupDiagnostics({ state, requestError = '' }: { state?: SetupState | null; requestError?: string }) {
  const text = useText()
  const [copied, setCopied] = useState('')
  const [copyError, setCopyError] = useState('')
  const report = setupReport(state, requestError)
  const log = useRef<HTMLTextAreaElement>(null)
  const follow = useRef(true)
  useEffect(() => { if (log.current && follow.current) log.current.scrollTop = log.current.scrollHeight }, [report])
  const issue = setupIssue(report, state)
  const failed = Boolean(requestError || state?.error || state?.resources?.status === 'failed' || state?.environment.some(step => step.status === 'failed') || state?.models.some(model => model.status === 'failed'))
  async function copy() {
    setCopyError('')
    try { await copyText(report); setCopied(report) }
    catch (error) { setCopied(''); setCopyError(text('setup.copyFailed', { error: error instanceof Error ? error.message : String(error) })) }
  }
  return <section aria-label={text('setup.logs')} className={cn('mt-4 rounded-xl border border-border bg-card p-4', failed && 'border-status-danger/25 bg-status-danger/10')}>
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <span className="text-sm font-medium">{text('setup.logs')}</span>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={copy}>{copied === report ? <Check /> : <Copy />}{copied === report ? text('setup.logsCopied') : text('setup.copyLogs')}</Button>
        <a href={issue.url} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: 'outline', size: 'sm' })} onClick={() => { void copy() }}><ExternalLink />{text('setup.issue')}</a>
      </div>
    </div>
    {copyError && <p role="alert" className="mb-3 text-xs text-status-danger-fg">{copyError}</p>}
    <p className="mb-3 text-xs text-muted-foreground">{text('setup.issueHint')}</p>
    <details open={failed || Boolean(copyError)}>
      <summary className="cursor-pointer text-xs text-muted-foreground">{text('setup.viewLogs')}</summary>
      <div role={failed ? 'alert' : undefined} className="mt-3">
        <Textarea ref={log} aria-label={text('setup.logContent')} readOnly value={report} rows={10} onScroll={event => { const node = event.currentTarget; follow.current = node.scrollTop + node.clientHeight >= node.scrollHeight - 1 }} className="p-3 font-mono text-xs leading-relaxed" />
      </div>
    </details>
  </section>
}
