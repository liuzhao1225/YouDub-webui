import { forwardRef, type ComponentProps } from 'react'
import { type VariantProps } from 'class-variance-authority'
import { Button as HarnessButton } from './harness-primitives'
import { buttonVariants } from './button-styles'
import { cn } from '@/lib/utils'

type Props = Omit<ComponentProps<typeof HarnessButton>, 'variant' | 'size'> & VariantProps<typeof buttonVariants>
const variants = { default: 'primary', outline: 'outline', secondary: 'outline', tint: 'ghost', ghost: 'ghost', destructive: 'outline', link: 'ghost' } as const

/** Keep YouDub size/variant names; Harness owns the control and native button behavior. */
export const Button = forwardRef<HTMLButtonElement, Props>(function Button({ className, variant = 'default', size = 'default', ...props }, ref) {
  return <HarnessButton {...props} ref={ref} variant={variants[variant ?? 'default']} size={size && ['xs', 'sm', 'icon-xs', 'icon-sm'].includes(size) ? 'sm' : 'md'} className={cn(buttonVariants({ variant, size, className }))} />
})
export { buttonVariants }
