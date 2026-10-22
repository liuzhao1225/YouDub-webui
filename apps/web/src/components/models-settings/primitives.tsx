import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { X } from '@/lib/icons'
import type { ReactNode, RefObject } from 'react'
import { cn } from '@/lib/utils'
export { Button } from '@/components/ui/button'
export { Plus as IconPlusOutline16, ChevronDown as IconChevronDownOutline14, ChevronRight as IconChevronRightOutline14, Trash2 as IconTrashOutline16 } from '@/lib/icons'

/** The original editor Modal face, rendered by YouDub's existing Base UI stack. */
export function Modal({ open, onClose, title, closeLabel, description, className, footer, children, finalFocus }: {
  open: boolean; onClose(): void; title: string; closeLabel: string; description?: string
  className?: string; footer?: ReactNode; children?: ReactNode
  finalFocus?: RefObject<HTMLElement | null> | (() => HTMLElement | null)
}) {
  return <Dialog.Root open={open} onOpenChange={next => { if (!next) onClose() }}>
    <Dialog.Portal><Dialog.Backdrop />
      <Dialog.Popup finalFocus={finalFocus} className={cn('w-[min(32rem,100%)]', className)} {...description ? {} : { 'aria-describedby': undefined }}>
        <div className="flex items-center justify-between gap-3"><Dialog.Title >{title}</Dialog.Title><Button type="button" onClick={onClose} aria-label={closeLabel} variant="ghost" size="default"><X size={16} /></Button></div>
        {description ? <Dialog.Description className="text-sm text-muted-foreground">{description}</Dialog.Description> : null}
        {children}
        {footer ? <div className="flex justify-end gap-2">{footer}</div> : null}
      </Dialog.Popup>
    </Dialog.Portal>
  </Dialog.Root>
}
