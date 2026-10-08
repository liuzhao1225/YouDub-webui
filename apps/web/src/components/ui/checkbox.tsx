"use client"

import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox"
import { Check, Minus } from "lucide-react"

import { cn } from "@/lib/utils"

function Checkbox({ className, indeterminate, ...props }: CheckboxPrimitive.Root.Props) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      indeterminate={indeterminate}
      className={cn(
        "relative flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-[5px] border border-input bg-input-bg text-white shadow-xs transition-[background-color,border-color,box-shadow] outline-none after:absolute after:-inset-2.5 focus-visible:ring-3 focus-visible:ring-ring/40 data-checked:border-transparent data-checked:bg-[#0a8fc4] data-indeterminate:border-transparent data-indeterminate:bg-[#0a8fc4] data-disabled:cursor-not-allowed data-disabled:opacity-35",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="flex items-center justify-center">
        {indeterminate ? <Minus className="size-3" strokeWidth={3} /> : <Check className="size-3" strokeWidth={3} />}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
