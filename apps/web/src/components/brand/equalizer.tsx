import { cn } from "@/lib/utils"

const DELAYS = [-0.45, -0.1, -0.7]

export function Equalizer({ className }: { className?: string }) {
  return (
    <span aria-hidden="true" className={cn("inline-flex h-3 items-center gap-[2px]", className)}>
      {DELAYS.map((delay) => (
        <span
          key={delay}
          className="h-full w-[2px] origin-center animate-eq rounded-full bg-current"
          style={{ animationDelay: `${delay}s` }}
        />
      ))}
    </span>
  )
}
