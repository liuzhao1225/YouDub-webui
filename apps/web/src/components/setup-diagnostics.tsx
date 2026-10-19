'use client'

import { useState } from 'react'
import { Check, Copy, ExternalLink } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { setupIssue, setupReport } from '@/lib/setup-diagnostics'
import { cn } from '@/lib/utils'
import type { SetupState } from './setup-screen'

export function SetupDiagnostics({ state, requestError = '' }: { state?: SetupState | null; requestError?: string }) {
  const [copied, setCopied] = useState('')
  const [copyError, setCopyError] = useState('')
  const report = setupReport(state, requestError)
  const issue = setupIssue(report, state)
  const failed = Boolean(requestError || state?.error || state?.environment.some(step => step.status === 'failed') || state?.models.some(model => model.status === 'failed'))
  async function copy() {
    setCopyError('')
    try { await navigator.clipboard.writeText(report); setCopied(report) }
    catch (error) { setCopied(''); setCopyError(`复制失败：${error instanceof Error ? error.message : String(error)}。请在下方日志中全选并复制。`) }
  }
  return <section aria-label="诊断日志" className={cn('mt-4 rounded-xl border border-border bg-card p-4', failed && 'border-status-danger/25 bg-status-danger/10')}>
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <span className="text-sm font-medium">诊断日志</span>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={copy}>{copied === report ? <Check /> : <Copy />}{copied === report ? '已复制日志' : '复制日志'}</Button>
        <a href={issue.url} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: 'outline', size: 'sm' })} onClick={() => { void copy() }}><ExternalLink />反馈 Issue</a>
      </div>
    </div>
    {copyError && <p role="alert" className="mb-3 text-xs text-status-danger-fg">{copyError}</p>}
    <p className="mb-3 text-xs text-muted-foreground">点击反馈会复制完整日志，请粘贴到 Issue 正文。</p>
    <details open={failed || Boolean(copyError)}>
      <summary className="cursor-pointer text-xs text-muted-foreground">查看日志</summary>
      <div role={failed ? 'alert' : undefined} className="mt-3">
        <textarea aria-label="诊断日志内容" readOnly value={report} rows={10} className="w-full resize-y rounded-lg border border-border bg-background p-3 font-mono text-xs leading-relaxed text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
      </div>
    </details>
  </section>
}
