"use client"

import type { ReactElement, ReactNode } from "react"
import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip"

import { cn } from "@/lib/utils"

function Tooltip({
  content,
  children,
  side = "top",
  className,
}: {
  content: ReactNode
  children: ReactElement
  side?: "top" | "bottom" | "left" | "right"
  className?: string
}) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger delay={250} render={children} />
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Positioner side={side} sideOffset={8} className="z-[70]">
          <TooltipPrimitive.Popup
            className={cn(
              "rounded-md bg-foreground px-2 py-1 text-xs font-medium text-background shadow-float transition-[opacity,transform] duration-100 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0",
              className
            )}
          >
            {content}
          </TooltipPrimitive.Popup>
        </TooltipPrimitive.Positioner>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  )
}

export { Tooltip }
