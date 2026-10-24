import { forwardRef, type ComponentProps } from 'react'
import clsx from 'clsx'
import editor from './InlineEditor.module.css'
import css from './Textarea.module.css'

/** Multi-line form input sharing the Harness inline-editor appearance. */
export const Textarea = forwardRef<HTMLTextAreaElement, ComponentProps<'textarea'>>(function Textarea({ className, ...props }, ref) {
  return <textarea {...props} ref={ref} className={clsx(editor.editor, css.textarea, className)} />
})
