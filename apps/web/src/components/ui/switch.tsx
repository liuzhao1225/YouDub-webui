import { Switch as HarnessSwitch } from '../../../../../vendor/deepseek-harness/source/packages/client/ui-primitives/src/Switch'

type Props = { checked: boolean; onCheckedChange: (checked: boolean) => void; disabled?: boolean; title?: string; className?: string; 'aria-label': string; 'aria-labelledby'?: string }
export function Switch({ onCheckedChange, 'aria-label': label, 'aria-labelledby': _labelledBy, ...props }: Props) {
  return <HarnessSwitch {...props} label={label} onChange={onCheckedChange} />
}
