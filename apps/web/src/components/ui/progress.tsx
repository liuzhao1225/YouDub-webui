import { cn } from '@/lib/utils'
import styles from './progress.module.css'
/** Fraction 0–1; undefined means unknown total. */
export function Progress({ value, label, paused = false, className }: { value?: number; label: string; paused?: boolean; className?: string }) {
  const percent = value == null ? undefined : Math.floor(Math.max(0, Math.min(1, value)) * 100)
  return <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} data-paused={paused || undefined} data-complete={percent === 100 || undefined} data-indeterminate={percent == null || undefined} className={cn(styles.track, className)}><span className={styles.fill} style={percent == null ? undefined : { width: `${percent}%` }} /></div>
}
