/** Operations and values exchanged with a Client realm's read-only source catalog. */

import type { RuntimeScriptKey } from '../../../cdp/ids.ts'
import type { RuntimeScript } from '../../../cdp/index.ts'

/** Script metadata that excludes the Worker-owned execution-context id. */
export type ClientScriptDescriptor = Omit<RuntimeScript, 'executionContextId'>

/** Content stored for one Client script. */
export type ClientSourceContentKind = 'source' | 'source-map'

/** Read-only operation accepted by the Client source catalog. */
export type ClientSourceCommand =
  | { readonly op: 'list-scripts' }
  | {
    readonly op: 'get-content-chunk'
    readonly scriptKey: RuntimeScriptKey
    readonly content: ClientSourceContentKind
    readonly offset: number
    readonly maxBytes: number
  }

/** Successful result of one Client source operation. */
export type ClientSourceResult =
  | { readonly op: 'list-scripts'; readonly scripts: readonly ClientScriptDescriptor[] }
  | {
    readonly op: 'get-content-chunk'
    readonly scriptKey: RuntimeScriptKey
    readonly content: ClientSourceContentKind
    readonly available: false
  }
  | {
    readonly op: 'get-content-chunk'
    readonly scriptKey: RuntimeScriptKey
    readonly content: ClientSourceContentKind
    readonly available: true
    readonly offset: number
    readonly nextOffset: number
    readonly data: string
    readonly eof: boolean
  }

/** Deliberate failure returned by the Client source catalog. */
export interface ClientSourceError {
  readonly code: 'invalid-request' | 'script-not-found' | 'load-failed' | 'result-too-large' | 'internal-error'
  readonly message: string
}
