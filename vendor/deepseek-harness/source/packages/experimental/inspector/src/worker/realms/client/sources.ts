/** Client SourceBackend over the bounded browser source-catalog transport. */

import type { ClientScriptDescriptor, ClientSourceResult } from '../../../shared/bridge/messages/sources/index.ts'
import type { ClientSourceSessionId } from '../../../shared/bridge/ids.ts'
import type { RuntimeScriptKey } from '../../../shared/cdp/ids.ts'
import type { RuntimeScript } from '../../../shared/cdp/index.ts'
import type { ClientRuntimeTarget } from '../../bridge/runtime-rpc.ts'
import type { ClientSourceRouter } from '../../bridge/source-rpc.ts'
import type { SourceBackend } from '../../../shared/cdp/realm.ts'
import type { ClientScriptIdentity } from './scripts.ts'

interface ClientScriptRoute {
  readonly localKey: RuntimeScriptKey
}

/** Presents one Client bundle catalog through the common read-only source model. */
export class ClientSourceBackend implements SourceBackend {
  private readonly scripts = new Map<RuntimeScriptKey, ClientScriptRoute>()
  private catalog: Promise<readonly RuntimeScript[]> | undefined
  private closed = false

  constructor(
    private readonly target: ClientRuntimeTarget,
    private readonly sessionId: ClientSourceSessionId,
    private readonly router: ClientSourceRouter,
    private readonly scriptIds: ClientScriptIdentity,
  ) {}

  async listScripts(): Promise<readonly RuntimeScript[]> {
    if (this.closed) throw new Error('Client source session is closed')
    this.catalog ??= this.loadCatalog()
    return this.catalog
  }

  async getScriptSource(scriptKey: RuntimeScriptKey): Promise<string> {
    const route = await this.route(scriptKey)
    const source = await this.read(route.localKey, 'source')
    if (source === undefined) throw new Error('Client script source is unavailable')
    return source
  }

  async getSourceMap(scriptKey: RuntimeScriptKey): Promise<string | undefined> {
    const route = await this.route(scriptKey)
    return this.read(route.localKey, 'source-map')
  }

  subscribe(_listener: (script: RuntimeScript) => void): () => void {
    return () => {}
  }

  /** Reject pending reads owned by this DevTools connection. */
  close(): void {
    if (this.closed) return
    this.closed = true
    this.router.closeSession(this.target.source, this.sessionId)
    this.scripts.clear()
  }

  private async loadCatalog(): Promise<readonly RuntimeScript[]> {
    const result = expectResult(await this.router.request(
      this.target.source,
      this.sessionId,
      { op: 'list-scripts' },
    ), 'list-scripts')
    return result.scripts.map(script => this.register(script))
  }

  private register(script: ClientScriptDescriptor): RuntimeScript {
    const scriptKey = this.scriptIds.toRuntime(script.scriptKey)
    const descriptor: RuntimeScript = {
      ...script,
      scriptKey,
      executionContextId: this.target.contextId,
    }
    this.scripts.set(scriptKey, { localKey: script.scriptKey })
    return descriptor
  }

  private async route(scriptKey: RuntimeScriptKey): Promise<ClientScriptRoute> {
    await this.listScripts()
    const route = this.scripts.get(scriptKey)
    if (route === undefined) throw new Error('Client script is no longer available')
    return route
  }

  private async read(
    scriptKey: RuntimeScriptKey,
    content: 'source' | 'source-map',
  ): Promise<string | undefined> {
    const chunks: Uint8Array[] = []
    let offset = 0
    while (true) {
      const result = expectResult(await this.router.request(this.target.source, this.sessionId, {
        op: 'get-content-chunk',
        scriptKey,
        content,
        offset,
        maxBytes: this.router.chunkBytes,
      }), 'get-content-chunk')
      if (!result.available) return undefined
      const bytes = Buffer.from(result.data, 'base64')
      if (bytes.byteLength > this.router.chunkBytes
        || result.nextOffset !== offset + bytes.byteLength
        || (!result.eof && result.nextOffset === offset)
        || result.nextOffset > this.router.maxContentBytes) {
        throw new Error('Client source returned an invalid content chunk')
      }
      chunks.push(bytes)
      offset = result.nextOffset
      if (result.eof) break
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))
  }
}

function expectResult<Operation extends ClientSourceResult['op']>(
  result: ClientSourceResult,
  operation: Operation,
): Extract<ClientSourceResult, { op: Operation }> {
  if (result.op !== operation) throw new Error(`Client source returned ${result.op} for ${operation}`)
  return result as Extract<ClientSourceResult, { op: Operation }>
}
