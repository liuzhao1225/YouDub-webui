// TrajectoryTurnHeader: sticky per-turn bar with Input/Output/Think/Time labels.

import css from './TrajectoryTurnHeader.module.css'
import type { TrajectoryKey, TrajectoryTranslate } from './locales.ts'

const COLUMN_LABEL_KEYS: readonly TrajectoryKey[] = [
  'column.input', 'column.output', 'column.think', 'column.time',
]

export interface TrajectoryTurnHeaderProps {
  /** 1-based turn index shown as `Turn N`. */
  turn: number
  /** Trajectory locale seat. */
  t: TrajectoryTranslate
}

/**
 * Render the sticky turn header row.
 * @param props.turn - turn index.
 * @returns the sticky header element.
 */
export function TrajectoryTurnHeader({ turn, t }: TrajectoryTurnHeaderProps) {
  return (
    <div className={css.root}>
      <div className={css.inner}>
        <span className={css.title}>{t('turn.label', { turn })}</span>
        <div className={css.columns} aria-hidden="true">
          {COLUMN_LABEL_KEYS.map(key => (
            <span key={key} className={css.column}>{t(key)}</span>
          ))}
        </div>
      </div>
    </div>
  )
}
