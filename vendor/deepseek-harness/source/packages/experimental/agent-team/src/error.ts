/** Typed Agent Teams failures. */

import { inspect } from 'node:util'
import { HarnessError } from '@deepseek-ai/dsh-llm'

/** Stable failure raised by the Team domain. */
export class TeamError extends HarnessError {
  constructor(message: string, code: string, options?: ErrorOptions) {
    super(message, code, options)
    this.name = 'TeamError'
  }
}

/**
 * Render an arbitrary thrown value without replacing the original rejection.
 * @param error - caught value used in a diagnostic or durable failure record.
 * @returns one bounded single-line description.
 */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return inspect(error, { breakLength: Infinity, compact: true, depth: 4 })
}
