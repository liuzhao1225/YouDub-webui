export type StatusTone = "success" | "running" | "danger" | "warning" | "neutral"

// v1 任务状态：waiting 是远端已接受、仍在推进，与 running 同色；cancelling 正在停止，用警示色。
export function statusTone(status?: string | null): StatusTone {
  if (status === "succeeded") return "success"
  if (status === "running" || status === "waiting") return "running"
  if (status === "failed") return "danger"
  if (status === "cancelling") return "warning"
  return "neutral"
}

// 浅色底 + 同色相前景，两套主题下文字对比度均不低于 4.5:1。
export const STATUS_BADGE_CLASSES: Record<StatusTone, string> = {
  success: "bg-status-success/10 text-status-success-fg ring-status-success/25",
  running: "bg-status-running/10 text-status-running-fg ring-status-running/30",
  danger: "bg-status-danger/10 text-status-danger-fg ring-status-danger/25",
  warning: "bg-status-warning/10 text-status-warning-fg ring-status-warning/30",
  neutral: "bg-status-neutral/10 text-status-neutral-fg ring-status-neutral/20",
}

export const STATUS_DOT_CLASSES: Record<StatusTone, string> = {
  success: "bg-status-success",
  running: "bg-status-running",
  danger: "bg-status-danger",
  warning: "bg-status-warning",
  neutral: "bg-status-neutral",
}
