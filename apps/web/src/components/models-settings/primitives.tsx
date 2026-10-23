import { Modal as HarnessModal } from '@/components/ui/harness-primitives'
import { useEffect, useRef, type ReactNode, type RefObject } from 'react'
export { Button } from '@/components/ui/button'
export { Plus as IconPlusOutline16, ChevronDown as IconChevronDownOutline14, ChevronRight as IconChevronRightOutline14, Trash2 as IconTrashOutline16 } from '@/lib/icons'

/** Harness owns dialog geometry, keyboard layers and focus trapping. */
export function Modal({ finalFocus, ...props }: {
  open: boolean; onClose(): void; title: string; closeLabel: string; description?: string
  className?: string; footer?: ReactNode; children?: ReactNode
  finalFocus?: RefObject<HTMLElement | null> | (() => HTMLElement | null)
}) {
  const wasOpen = useRef(props.open)
  useEffect(() => {
    if (wasOpen.current && !props.open && finalFocus) {
      const target = typeof finalFocus === 'function' ? finalFocus() : finalFocus.current
      target?.focus()
    }
    wasOpen.current = props.open
  }, [props.open, finalFocus])
  return <HarnessModal {...props} />
}
