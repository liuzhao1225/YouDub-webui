import { useId } from 'react'
import { SegmentedControl } from './harness-primitives'
import { cn } from '@/lib/utils'
type SegmentedOption<T extends string> = { value: T; label: string; disabled?: boolean }
export function Segmented<T extends string>({ id, value, onChange, options, ariaLabel, className, disabled }: { id?: string; value: T; onChange: (value: T) => void; options: SegmentedOption<T>[]; ariaLabel: string; size?: 'default' | 'sm'; className?: string; disabled?: boolean }) {
  const generatedId = useId()
  return <SegmentedControl id={id ?? generatedId} value={value} onChange={onChange} label={ariaLabel} disabled={disabled} className={cn('inline-grid [&_svg]:size-4 [&_svg]:shrink-0', className)} options={options} />
}
export type { SegmentedOption }
