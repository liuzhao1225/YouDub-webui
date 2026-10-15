import type { ReactNode } from "react"
import { CircleAlert, Info, TriangleAlert } from "lucide-react"

import { cn } from "@/lib/utils"

type AlertTone = "danger" | "warning" | "info"

const TONE_STYLES: Record<AlertTone, string> = {
  danger: "border-status-danger/25 bg-status-danger/10 text-status-danger-fg",
  warning: "border-status-warning/30 bg-status-warning/10 text-status-warning-fg",
  info: "border-status-success/25 bg-status-success/10 text-status-success-fg",
}

const TONE_ICONS = {
  danger: CircleAlert,
  warning: TriangleAlert,
  info: Info,
}

export function InlineAlert({
  tone = "danger",
  children,
  className,
}: {
  tone?: AlertTone
  children: ReactNode
  className?: string
}) {
  const Icon = TONE_ICONS[tone]
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-sm",
        TONE_STYLES[tone],
        className,
      )}
    >
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1 leading-relaxed break-words">{children}</div>
    </div>
  )
}
