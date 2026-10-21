/** Realm-neutral script metadata used by source backends. */

import type { RuntimeScriptKey } from './ids.ts'

/** One script visible in a realm's source catalog. */
export interface RuntimeScript {
  readonly scriptKey: RuntimeScriptKey
  readonly url: string
  readonly hash: string
  readonly buildId?: string
  readonly sourceMapUrl?: string
  readonly startLine: number
  readonly startColumn: number
  readonly endLine: number
  readonly endColumn: number
  readonly executionContextId?: number
  readonly isModule?: boolean
  readonly length?: number
}
