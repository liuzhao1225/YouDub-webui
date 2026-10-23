import * as React from "react"
import { Input as HarnessInput } from "./harness-primitives"
import state from "./control-state.module.css"
import { cn } from "@/lib/utils"

export const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<typeof HarnessInput>>(function Input({ className, ...props }, ref) {
  return <HarnessInput {...props} ref={ref} className={cn(state.input, "w-full min-w-0", className)} />
})
