import { Progress } from '@/components/ui/progress'
import type { MessageKey, Text } from '@/locales'
import { Tag } from '@/components/ui/tag'
import { useI18n, useText } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { text, type TaskStatus, type TaskSummary, type TaskView } from '../sdk'

export const ACTIVE_STATUSES = new Set<TaskStatus>(['queued', 'running', 'waiting', 'paused', 'cancelling'])
export const STATUS_LABELS: Record<string, MessageKey> = {
  "queued": "status_labels.queued",
  "running": "status_labels.running",
  "waiting": "status_labels.waiting",
  "cancelling": "status_labels.cancelling",
  "cancelled": "status_labels.cancelled",
  "succeeded": "status_labels.succeeded",
  "failed": "status_labels.failed",
  "pending": "status_labels.pending",
  "completed": "status_labels.completed",
  "paused": "status_labels.paused",
  "awaiting_review": "status_labels.awaiting_review"
}

export function taskDisplayName(task: TaskSummary & Pick<TaskView, 'graphSnapshot'>) {
  return task.sourceName && task.sourceName !== task.workflowId ? task.sourceName : task.workflowSource?.title || task.graphSnapshot?.title || task.sourceName
}

// Keep persisted provider messages and raw logs unchanged; localize their display.
export function taskProgressMessage(message: string, tx: Text): string {
  if (message === '翻译完成') return tx('task.progress.translation.complete')
  const batch = /^翻译 (\d+)\/(\d+)$/.exec(message)
  return batch ? tx('task.progress.translation.batch', { current: batch[1], total: batch[2] }) : message
}

export function TaskState({ status }: { status: string }) {
  const tx = useText()
  return <Tag tone={status === 'failed' ? 'danger' : status === 'paused' || status === 'awaiting_review' ? 'warning' : status === 'succeeded' || status === 'completed' ? 'success' : 'neutral'}>{STATUS_LABELS[status] ? tx(STATUS_LABELS[status]) : status}</Tag>
}

export function TaskProgress({ task }: { task: TaskSummary }) {
  const tx = useText()
  const { language } = useI18n()
  if (!ACTIVE_STATUSES.has(task.status)) return null
  const step = task.status === 'queued' ? undefined : task.steps.find((item) => item.status === 'running' || item.status === 'waiting') ?? task.steps.find((item) => item.status === 'awaiting_review')
  const reviews = task.steps.filter((item) => item.status === 'awaiting_review').length
  const completed = task.steps.filter((item) => item.status === 'completed').length
  const progress = task.status === 'running' && step?.status === 'running' ? step.progress : null
  const label = step ? text(step.label, language) : ''
  if (!step && !task.steps.length) return null
  return <div className="space-y-2 text-xs text-muted-foreground">
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
      {step && <span className="min-w-0 break-words">{label}{progress != null ? ` · ${Math.round(progress * 100)}%` : ''}</span>}
      {task.steps.length > 0 && <span className="whitespace-nowrap">{tx("task.status.value.value.steps.completed", { value1: completed, value2: task.steps.length })}</span>}
    </div>
    {reviews > 0 && <p className="text-status-warning-fg">{tx("task.status.value.nodes.awaiting.review", { value1: reviews })}</p>}
    {progress != null && <Progress label={`${label} ${tx("task.status.progress")}`} value={progress} />}
  </div>
}
