"use client"

import * as React from "react"
import { Select as SelectPrimitive } from "@base-ui/react/select"
import { Check, ChevronDown } from "@/lib/icons"

import menu from '../../../../../vendor/deepseek-harness/source/packages/client/ui-primitives/src/Menu.module.css'
import surface from '../../../../../vendor/deepseek-harness/source/packages/client/ui-primitives/src/MenuSurface.module.css'
import { buttonVariants } from './button-styles'
import { cn } from "@/lib/utils"

function Select({ ...props }: SelectPrimitive.Root.Props<string>) {
  return <SelectPrimitive.Root data-slot="select" {...props} />
}

function SelectTrigger({
  className,
  children,
  showChevron = true,
  ...props
}: SelectPrimitive.Trigger.Props & { showChevron?: boolean }) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      className={cn(
        buttonVariants({ variant: 'outline' }), 'w-full min-w-0 justify-between',
        className
      )}
      {...props}
    >
      {children}
      {showChevron && <SelectPrimitive.Icon className="shrink-0 text-subtle-foreground">
        <ChevronDown className="size-4" />
      </SelectPrimitive.Icon>}
    </SelectPrimitive.Trigger>
  )
}

function SelectContent({
  className,
  children,
  ...props
}: SelectPrimitive.Popup.Props) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner alignItemWithTrigger={false} sideOffset={4} className="z-[1100]">
        <SelectPrimitive.Popup
          data-slot="select-content"
          className={cn(
            menu.list, surface.surface, 'relative! top-auto! left-auto! min-w-(--anchor-width) max-h-72 outline-none',
            className
          )}
          {...props}
        >
          <span aria-hidden="true" className={surface.material} /><SelectPrimitive.List className="max-h-64 overflow-y-auto">{children}</SelectPrimitive.List>
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  )
}

function SelectItem({
  className,
  children,
  ...props
}: SelectPrimitive.Item.Props) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        menu.item, 'relative pl-7! data-disabled:pointer-events-none data-disabled:opacity-40 data-highlighted:bg-accent',
        className
      )}
      {...props}
    >
      <SelectPrimitive.ItemIndicator className="absolute left-2.5 flex size-4 items-center justify-center text-primary">
        <Check className="size-4" />
      </SelectPrimitive.ItemIndicator>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  )
}

export {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
}
