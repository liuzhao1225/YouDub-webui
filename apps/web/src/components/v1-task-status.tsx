"use client"

import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { statusBadgeClass } from "@/lib/status"
import type { TaskSummary, WaitReason } from "@/lib/v1-api"
import { STAGE_LABELS, STATUS_LABELS, useV1Text } from "@/lib/v1-ui"

const WAIT_LABELS: Record<WaitReason, [string, string, string]> = {
  active_limit: ["Waiting for the previous task", "等待前一个任务完成", "前のタスクの完了待ち"],
  cpu: ["Waiting for CPU", "等待 CPU", "CPU の空き待ち"],
  gpu: ["Waiting for GPU", "等待 GPU", "GPU の空き待ち"],
  remote_limit: ["Waiting for provider capacity", "等待远端处理名额", "外部サービスの空き待ち"],
  remote_result: ["Waiting for provider result", "等待远端处理结果", "外部サービスの結果待ち"],
}

export function TaskStatusView({ task }: { task: TaskSummary }) {
  const text = useV1Text()
  const progress = task.stage_progress === null ? null : Math.round(task.stage_progress * 100)
  return <div className="space-y-2 text-sm">
    <div className="flex flex-wrap items-center gap-2"><Badge className={statusBadgeClass(task.status)}>{text(...STATUS_LABELS[task.status])}</Badge>
      <span>{text(...STAGE_LABELS[task.current_stage])}</span>
      {progress !== null && task.current_stage !== "done" && <span className="tabular-nums text-muted-foreground">{progress}%</span>}
    </div>
    {progress !== null && task.current_stage !== "done" && <Progress aria-label={text("Current step progress", "当前阶段进度", "現在の処理の進捗")} value={progress} />}
    {task.wait_reason && <p className="text-xs text-muted-foreground">{text(...WAIT_LABELS[task.wait_reason])}</p>}
  </div>
}
