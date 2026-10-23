import type { ComponentProps } from 'react'
import { Tooltip as HarnessTooltip } from './harness-primitives'

type Props = Omit<ComponentProps<typeof HarnessTooltip>, 'label'> & { content: string }
export function Tooltip({ content, side = 'top', ...props }: Props) {
  return <HarnessTooltip {...props} portal label={content} side={side} />
}
