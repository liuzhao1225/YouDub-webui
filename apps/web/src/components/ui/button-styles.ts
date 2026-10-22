import { cva } from 'class-variance-authority'
import styles from '../../../../../vendor/deepseek-harness/source/packages/client/ui-primitives/src/Button.module.css'

/** Shared Harness appearance, including links that use the button face. */
export const buttonVariants = cva([styles.button, '[&_svg]:size-4 [&_svg]:shrink-0'], {
  variants: {
    variant: {
      default: styles.primary,
      outline: styles.outline,
      secondary: styles.outline,
      tint: styles.ghost,
      ghost: styles.ghost,
      destructive: [styles.outline, 'text-status-danger-fg'],
      link: [styles.ghost, 'text-link'],
    },
    size: {
      default: styles.md,
      xs: styles.sm,
      sm: styles.sm,
      lg: styles.md,
      xl: [styles.md, 'h-11'],
      icon: [styles.md, 'size-9 p-0'],
      'icon-xs': [styles.sm, 'size-7 p-0'],
      'icon-sm': [styles.sm, 'size-8 p-0'],
      'icon-lg': [styles.md, 'size-10 p-0'],
    },
  },
  defaultVariants: { variant: 'default', size: 'default' },
})
