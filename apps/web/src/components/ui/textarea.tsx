import * as React from 'react'
import styles from '../../../../../vendor/deepseek-harness/source/packages/client/ui-primitives/src/InlineEditor.module.css'
import state from './control-state.module.css'
import { cn } from '@/lib/utils'

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<'textarea'>>(function Textarea({ className, ...props }, ref) {
  return <textarea {...props} ref={ref} className={cn(styles.editor, state.textarea, 'w-full max-h-none resize-y', className)} />
})
