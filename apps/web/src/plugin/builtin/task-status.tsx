import { Tag } from '@/components/ui/tag'
import { useI18n, useText } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { text, type TaskStatus, type TaskSummary, type TaskView } from '../sdk'

export const ACTIVE_STATUSES = new Set<TaskStatus>(['queued', 'running', 'waiting', 'paused', 'cancelling'])
export const STATUS_LABELS: Record<string, [string, string, string]> = {
  queued: ['Queued', '排队中', '順番待ち'], running: ['Running', '处理中', '処理中'],
  waiting: ['Waiting', '等待中', '待機中'], cancelling: ['Cancelling', '正在取消', 'キャンセル中'],
  cancelled: ['Cancelled', '已取消', 'キャンセル済み'], succeeded: ['Completed', '已完成', '完了'], failed: ['Failed', '失败', '失敗'],
  pending: ['Pending', '未开始', '未開始'], completed: ['Completed', '已完成', '完了'],
  paused: ['Waiting for node reviews', '等待节点确认', 'ノードの確認待ち'], awaiting_review: ['Awaiting review', '待确认', '確認待ち'],
}

export function taskDisplayName(task: TaskSummary & Pick<TaskView, 'graphSnapshot'>) {
  return task.sourceName && task.sourceName !== task.workflowId ? task.sourceName : task.workflowSource?.title || task.graphSnapshot?.title || task.sourceName
}

export function TaskState({ status }: { status: string }) {
  const tx = useText()
  return <Tag tone={status === 'failed' ? 'danger' : status === 'paused' || status === 'awaiting_review' ? 'warning' : status === 'succeeded' || status === 'completed' ? 'success' : 'neutral'}>{STATUS_LABELS[status] ? tx(...STATUS_LABELS[status]) : status}</Tag>
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
      {task.steps.length > 0 && <span className="whitespace-nowrap">{tx(`${completed}/${task.steps.length} steps completed`, `已完成 ${completed}/${task.steps.length} 步`, `${completed}/${task.steps.length} ステップ完了`)}</span>}
    </div>
    {reviews > 0 && <p className="text-status-warning-fg">{tx(`${reviews} nodes awaiting review`, `${reviews} 个节点待确认`, `${reviews} 件のノードが確認待ち`)}</p>}
    {progress != null && <progress aria-label={`${label} ${tx('progress', '进度', '進捗')}`} value={progress} max={1} className="block h-1.5 w-full accent-primary" />}
  </div>
}
