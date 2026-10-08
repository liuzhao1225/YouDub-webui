import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

type SegmentedOption<T extends string> = {
  value: T
  label: ReactNode
  icon?: ReactNode
  ariaLabel?: string
}

function Segmented<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
  size = "default",
  className,
}: {
  value: T
  onChange: (value: T) => void
  options: SegmentedOption<T>[]
  ariaLabel: string
  size?: "default" | "sm"
  className?: string
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      data-slot="segmented"
      className={cn(
        "inline-flex items-center gap-0.5 rounded-lg bg-muted p-0.5 ring-1 ring-border ring-inset",
        className
      )}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          aria-label={option.ariaLabel}
          onClick={() => onChange(option.value)}
          className={cn(
            "inline-flex flex-1 items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap text-muted-foreground transition-[color,background-color,box-shadow] outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40 aria-pressed:bg-card aria-pressed:text-foreground aria-pressed:shadow-sm aria-pressed:ring-1 aria-pressed:ring-border dark:aria-pressed:bg-white/10 [&_svg]:size-3.5 [&_svg]:shrink-0",
            size === "sm" ? "h-7 px-2.5 text-xs" : "h-8 px-3 text-[13px]"
          )}
        >
          {option.icon}
          {option.label}
        </button>
      ))}
    </div>
  )
}

export { Segmented, type SegmentedOption }
