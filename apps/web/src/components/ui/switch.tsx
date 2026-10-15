"use client"

import { Switch as SwitchPrimitive } from "@base-ui/react/switch"

import { cn } from "@/lib/utils"

function Switch({ className, ...props }: SwitchPrimitive.Root.Props) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full bg-foreground/15 p-0.5 transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/40 data-checked:bg-[#0a8fc4] data-disabled:cursor-not-allowed data-disabled:opacity-50",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="block size-4 rounded-full bg-white shadow-sm ring-1 ring-black/5 transition-transform duration-150 data-checked:translate-x-4" />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
