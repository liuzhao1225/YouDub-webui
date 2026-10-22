import React from 'react'
import { inputClassName } from './input-styles'
import { cn } from '@/lib/utils'
/** Plain-web boundary; the Harness build maps these to its official Menu/Checkbox. */
export function NativeSelect({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) { return <select {...props} className={cn(inputClassName, className)} /> }
export function Choice({label,className,...props}: React.InputHTMLAttributes<HTMLInputElement> & {label?:string}) { return label ? <label className={className}><input type="checkbox" {...props} />{label}</label> : <input type="checkbox" className={className} {...props} /> }
