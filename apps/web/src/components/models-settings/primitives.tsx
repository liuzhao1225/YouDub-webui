import { Dialog } from '@base-ui/react/dialog'
import { X } from 'lucide-react'
import type { ReactNode, RefObject } from 'react'
import { cn } from '@/lib/utils'
export { Button } from '@/components/ui/button'
export { Plus as IconPlusOutline16, ChevronDown as IconChevronDownOutline14, ChevronRight as IconChevronRightOutline14, Trash2 as IconTrashOutline16 } from 'lucide-react'

/** The original editor Modal face, rendered by YouDub's existing Base UI stack. */
export function Modal({ open, onClose, title, closeLabel, description, className, footer, children, finalFocus }: {
  open: boolean; onClose(): void; title: string; closeLabel: string; description?: string
  className?: string; footer?: ReactNode; children?: ReactNode
  finalFocus?: RefObject<HTMLElement | null> | (() => HTMLElement | null)
}) {
  return <Dialog.Root open={open} onOpenChange={next => { if (!next) onClose() }}>
    <Dialog.Portal><Dialog.Backdrop className="fixed inset-0 z-[80] bg-black/50" />
      <Dialog.Popup finalFocus={finalFocus} className={cn('fixed top-1/2 left-1/2 z-[90] flex max-h-[calc(100dvh-3rem)] w-[calc(100vw-3rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto rounded-2xl border border-border bg-card p-6 text-foreground shadow-float outline-none', className)} {...description ? {} : { 'aria-describedby': undefined }}>
        <div className="flex items-center justify-between gap-3"><Dialog.Title className="text-base font-medium">{title}</Dialog.Title><button type="button" onClick={onClose} aria-label={closeLabel} className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent"><X size={16} /></button></div>
        {description ? <Dialog.Description className="text-sm text-muted-foreground">{description}</Dialog.Description> : null}
        {children}
        {footer ? <div className="flex justify-end gap-2">{footer}</div> : null}
      </Dialog.Popup>
    </Dialog.Portal>
  </Dialog.Root>
}
