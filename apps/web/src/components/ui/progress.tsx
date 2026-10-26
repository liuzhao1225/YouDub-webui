import styles from './progress.module.css'
/** Fraction 0–1; undefined means unknown total. */
export function Progress({ value, label, paused = false }: { value?: number; label: string; paused?: boolean }) {
  const percent = value == null ? undefined : Math.floor(Math.max(0, Math.min(1, value)) * 100)
  return <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} data-paused={paused || undefined} data-complete={percent === 100 || undefined} data-indeterminate={percent == null || undefined} className={styles.track}><span className={styles.fill} style={percent == null ? undefined : { width: `${percent}%` }} /></div>
}
