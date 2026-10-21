/** Environment-independent backend interfaces for inspected JavaScript realms. */

import type { RuntimeBackendObjectHandle, RuntimeScriptKey } from './ids.ts'
import type {
  RuntimeAwaitPromiseRequest,
  RuntimeCallFunctionRequest,
  RuntimeCompletion,
  RuntimeConsoleBackendEvent,
  RuntimeDebuggerEvent,
  RuntimeDebuggerEnableRequest,
  RuntimeDebuggerResumeRequest,
  RuntimeCallFrameEvaluationRequest,
  RuntimeEvaluateRequest,
  RuntimeGetPropertiesRequest,
  RuntimeExecutionContext,
  RuntimeProperties,
  RuntimeScript,
} from './index.ts'

/** Raw notification emitted by a native engine protocol backend. */
export interface NativeProtocolNotification {
  readonly method: string
  readonly params?: Readonly<Record<string, unknown>>
}

/** Explicitly supported or unsupported realm capability. */
export type RealmCapability<Backend> =
  | { readonly state: 'supported'; readonly backend: Backend }
  | { readonly state: 'unsupported'; readonly reason: string }

/** Runtime operations implemented inside one per-connection realm session. */
export interface RuntimeBackend {
  /** Prepare Runtime events and execution state for this connection. */
  enable(): Promise<void>
  /** Disable Runtime events and release backend session state. */
  disable(): Promise<void>
  /**
   * Evaluate source in this realm.
   * @param request - Engine-independent evaluation request.
   * @returns Completion containing a value or JavaScript exception.
   */
  evaluate(request: RuntimeEvaluateRequest): Promise<RuntimeCompletion<RuntimeBackendObjectHandle>>
  /**
   * Enumerate one retained object's properties.
   * @param request - Property request containing this backend's object handle.
   * @returns Property descriptors and optional exception details.
   */
  getProperties(
    request: RuntimeGetPropertiesRequest<RuntimeBackendObjectHandle>,
  ): Promise<RuntimeProperties<RuntimeBackendObjectHandle>>
  /**
   * Invoke a function with references owned by this realm session.
   * @param request - Function source, receiver, arguments, and result options.
   * @returns Completion containing the invocation result or JavaScript exception.
   */
  callFunction(
    request: RuntimeCallFunctionRequest<RuntimeBackendObjectHandle>,
  ): Promise<RuntimeCompletion<RuntimeBackendObjectHandle>>
  /**
   * Await one retained Promise.
   * @param request - Promise handle and result options.
   * @returns Completion containing the fulfilled value or rejection.
   */
  awaitPromise(
    request: RuntimeAwaitPromiseRequest<RuntimeBackendObjectHandle>,
  ): Promise<RuntimeCompletion<RuntimeBackendObjectHandle>>
  /**
   * Read names visible in one backend execution context's global lexical scope.
   * @param context - Native sub-context selector, or the realm default when omitted.
   * @returns Names visible in the selected global lexical scope.
   */
  globalLexicalScopeNames(context?: RuntimeExecutionContext): Promise<readonly string[]>
  /**
   * Release one backend object reference.
   * @param handle - Handle owned by this realm session.
   */
  releaseObject(handle: RuntimeBackendObjectHandle): Promise<void>
  /**
   * Release every backend object retained under one group.
   * @param group - DevTools object-group name.
   */
  releaseObjectGroup(group: string): Promise<void>
}

/** Realm Console event source. */
export interface ConsoleBackend {
  /**
   * Subscribe to Console and uncaught-exception events.
   * @param listener - Connection-local event consumer.
   * @returns A disposer for the subscription.
   */
  subscribe(listener: (event: RuntimeConsoleBackendEvent<RuntimeBackendObjectHandle>) => void): () => void
  /** Clear backend-owned Console history when supported. */
  clear(): Promise<void>
}

/** Realm script catalog independent of CDP ScriptId allocation. */
export interface SourceBackend {
  /** @returns Every script currently known to this realm. */
  listScripts(): Promise<readonly RuntimeScript[]>
  /**
   * Read source text for one realm-local script key.
   * @param scriptKey - Script identity allocated by this realm.
   * @returns The complete source text.
   */
  getScriptSource(scriptKey: RuntimeScriptKey): Promise<string>
  /**
   * Read an optional source map for one realm-local script key.
   * @param scriptKey - Script identity allocated by this realm.
   * @returns Source-map JSON when one exists.
   */
  getSourceMap(scriptKey: RuntimeScriptKey): Promise<string | undefined>
  /**
   * Subscribe to scripts discovered after the initial catalog read.
   * @param listener - Consumer of newly discovered scripts.
   * @returns A disposer for the subscription.
   */
  subscribe(listener: (script: RuntimeScript) => void): () => void
}

/** Active JavaScript debugging backend for one realm session. */
export interface DebuggerBackend {
  /** Enable debugger events for this connection. */
  enable(request: RuntimeDebuggerEnableRequest): Promise<Readonly<Record<string, unknown>>>
  /** Disable debugger events for this connection. */
  disable(): Promise<Readonly<Record<string, unknown>>>
  /** Pause this realm. */
  pause(): Promise<Readonly<Record<string, unknown>>>
  /** Resume this realm. */
  resume(request: RuntimeDebuggerResumeRequest): Promise<Readonly<Record<string, unknown>>>
  /**
   * Evaluate an expression in one paused frame.
   * @param request - Frame identity, expression, and result options.
   * @returns A common Runtime completion.
   */
  evaluateOnCallFrame(
    request: RuntimeCallFrameEvaluationRequest,
  ): Promise<RuntimeCompletion<RuntimeBackendObjectHandle>>
  /**
   * Subscribe to paused, resumed, and breakpoint events.
   * @param listener - Connection-local debugger event consumer.
   * @returns A disposer removing the consumer.
   */
  subscribe(listener: (event: RuntimeDebuggerEvent<RuntimeBackendObjectHandle>) => void): () => void
}

/** Explicit Host-only native protocol adapter for domains not yet normalized. */
export interface NativeDomainBackend {
  /**
   * Execute one native protocol request.
   * @param method - CDP method owned by the native engine.
   * @param params - Parsed CDP parameters.
   * @returns Native response fields.
   */
  request(method: string, params: Readonly<Record<string, unknown>>): Promise<Readonly<Record<string, unknown>>>
  /**
   * Subscribe to native protocol notifications.
   * @param listener - Notification consumer.
   * @returns A disposer removing the consumer.
   */
  subscribe(listener: (message: NativeProtocolNotification) => void): () => void
}
