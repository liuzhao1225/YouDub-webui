"use client"

import type { ReactElement, ReactNode } from "react"
import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip"

import styles from '../../../../../vendor/deepseek-harness/source/packages/client/ui-primitives/src/Tooltip.module.css'
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
        <TooltipPrimitive.Positioner side={side} sideOffset={8} className="z-[1100]">
          <TooltipPrimitive.Popup
            className={cn(
              styles.bubble, 'relative! inset-auto!',
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
