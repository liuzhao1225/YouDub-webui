import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"

import { inputClassName } from "./input-styles"
import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        inputClassName,
        className
      )}
      {...props}
    />
  )
}

export { Input }
