import type { ReactNode } from "react"

import { STATUS_BADGE_CLASSES, STATUS_DOT_CLASSES, statusTone } from "@/lib/status"
import { cn } from "@/lib/utils"
import { Equalizer } from "@/components/brand/equalizer"

export function StatusBadge({
  status,
  children,
  variant = "default",
  className,
}: {
  status?: string | null
  children: ReactNode
  // overlay：叠在封面等深色媒体上时使用，两套主题下都是深色玻璃底。
  variant?: "default" | "overlay"
  className?: string
}) {
  const tone = statusTone(status)
  return (
    <span
      data-slot="status-badge"
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset",
        variant === "overlay"
          ? "bg-black/55 text-white ring-white/15 backdrop-blur-md"
          : STATUS_BADGE_CLASSES[tone],
        className,
      )}
    >
      {status === "running" ? (
        <Equalizer className="h-2.5" />
      ) : (
        <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", STATUS_DOT_CLASSES[tone])} />
      )}
      {children}
    </span>
  )
}
