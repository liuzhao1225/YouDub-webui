import React from 'react'
import { buttonVariants } from './button-styles'
import checkbox from '../../../../../vendor/deepseek-harness/source/packages/client/ui-primitives/src/Checkbox.module.css'
import { cn } from '@/lib/utils'
/** Web form semantics; the desktop adapter uses Harness Button + Menu. */
export function NativeSelect({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) { return <select {...props} className={cn(buttonVariants({ variant: 'outline' }), 'w-full min-w-0', className)} /> }
export function Choice({ label, className, 'aria-label': accessibleLabel, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label?: string }) {
  return <label className={cn(checkbox.checkbox, className)}><input {...props} type="checkbox" aria-label={accessibleLabel ?? label} />{label && <span>{label}</span>}</label>
}
