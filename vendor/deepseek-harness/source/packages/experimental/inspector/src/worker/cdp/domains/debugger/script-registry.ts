/** Connection-local routing from CDP ScriptId values to realm source backends. */

import type { RuntimeScriptKey } from '../../../../shared/cdp/ids.ts'
import type { RuntimeScript } from '../../../../shared/cdp/index.ts'
import type { SourceBackend } from '../../../../shared/cdp/realm.ts'
import type { InspectorRealmSession } from '../../../inspection/realm.ts'
import { cdpStringId, type CdpScriptId } from '../../ids.ts'

/** One script and the realm source backend that owns its content. */
export interface DebuggerScriptRoute {
  readonly realm: InspectorRealmSession
  readonly source: SourceBackend
  readonly script: RuntimeScript
}

/** Tracks active and retired scripts without exposing source transport ids. */
export class DebuggerScriptRegistry {
  private readonly routes = new Map<CdpScriptId, DebuggerScriptRoute>()
  private readonly retiredUnsupported = new Set<CdpScriptId>()

  /**
   * Register one realm script under its globally unique Runtime script key.
   * @param route - Script descriptor and owning realm session.
   * @returns The CDP ScriptId and whether this is its first announcement.
   */
  register(route: DebuggerScriptRoute): { readonly scriptId: CdpScriptId; readonly fresh: boolean } {
    const scriptId = cdpScriptId(route.script.scriptKey)
    const current = this.routes.get(scriptId)
    if (current !== undefined && current.realm !== route.realm) {
      throw new Error(`Inspector realms produced the same script key ${scriptId}`)
    }
    this.routes.set(scriptId, route)
    return { scriptId, fresh: current === undefined }
  }

  /**
   * Resolve an active CDP ScriptId.
   * @param scriptId - Connection-visible script id.
   * @returns The active route when the script remains connected.
   */
  resolve(scriptId: string): DebuggerScriptRoute | undefined {
    return this.routes.get(cdpStringId<'CdpScriptId'>(scriptId, 'scriptId'))
  }

  /**
   * Resolve a script by its exact URL.
   * @param url - Script URL from a CDP request.
   * @returns The active route when one script has that URL.
   */
  byUrl(url: string): DebuggerScriptRoute | undefined {
    for (const route of this.routes.values()) {
      if (route.script.url === url) return route
    }
    return undefined
  }

  /**
   * Resolve a script by its exact content hash.
   * @param hash - Script hash from a breakpoint request.
   * @returns The active route when one script has that hash.
   */
  byHash(hash: string): DebuggerScriptRoute | undefined {
    for (const route of this.routes.values()) {
      if (route.script.hash === hash) return route
    }
    return undefined
  }

  /**
   * Resolve the first script whose URL matches a breakpoint regular expression.
   * @param pattern - JavaScript regular-expression source accepted by CDP.
   * @returns The first matching active route.
   */
  byUrlPattern(pattern: string): DebuggerScriptRoute | undefined {
    const expression = new RegExp(pattern, 'u')
    for (const route of this.routes.values()) {
      if (expression.test(route.script.url)) return route
    }
    return undefined
  }

  /**
   * Test whether a disconnected script belonged to a realm without active debugging.
   * @param scriptId - Script id from a later CDP request.
   * @returns Whether the id must still fail as an unsupported Client script.
   */
  wasUnsupported(scriptId: string): boolean {
    return this.retiredUnsupported.has(cdpStringId<'CdpScriptId'>(scriptId, 'scriptId'))
  }

  /**
   * Forget scripts for one closed realm while retaining their unsupported identity.
   * @param realm - Realm session being removed.
   */
  removeRealm(realm: InspectorRealmSession): void {
    for (const [scriptId, route] of this.routes) {
      if (route.realm !== realm) continue
      this.routes.delete(scriptId)
      if (realm.debugger.state === 'unsupported') this.retiredUnsupported.add(scriptId)
    }
  }

  /** Forget all active and retired script routes. */
  clear(): void {
    this.routes.clear()
    this.retiredUnsupported.clear()
  }
}

/**
 * Preserve a branded script key as its CDP wire identifier.
 * @param scriptKey - Realm-wide Runtime script key.
 * @returns The corresponding CDP ScriptId text.
 */
export function cdpScriptId(scriptKey: RuntimeScriptKey): CdpScriptId {
  return cdpStringId<'CdpScriptId'>(scriptKey, 'scriptId')
}
