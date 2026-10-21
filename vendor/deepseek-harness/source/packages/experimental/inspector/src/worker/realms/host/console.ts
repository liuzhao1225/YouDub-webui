/** ConsoleBackend implementation over native Node Runtime notifications. */

import type { RuntimeBackendObjectHandle } from '../../../shared/cdp/ids.ts'
import type {
  RuntimeConsoleBackendEvent,
  RuntimeConsoleType,
} from '../../../shared/cdp/index.ts'
import type { HostInspectorSession } from './bridge.ts'
import type { ConsoleBackend } from '../../../shared/cdp/realm.ts'
import { isNativeRecord } from './values.ts'
import { HostNotificationChannel } from './bridge.ts'
import type { HostRuntimeBackend } from './runtime.ts'

const CONSOLE_TYPES = new Set<RuntimeConsoleType>([
  'log', 'debug', 'info', 'error', 'warning', 'dir', 'dirxml', 'table', 'trace', 'clear',
  'startGroup', 'startGroupCollapsed', 'endGroup', 'assert', 'profile', 'profileEnd', 'count', 'timeEnd',
])

/** Converts native Runtime notifications to realm-neutral Console events. */
export class HostConsoleBackend implements ConsoleBackend {
  private readonly events: HostNotificationChannel<RuntimeConsoleBackendEvent<RuntimeBackendObjectHandle>>

  constructor(
    private readonly target: HostInspectorSession,
    private readonly runtime: HostRuntimeBackend,
  ) {
    this.events = new HostNotificationChannel(
      target,
      message => message.method === 'Runtime.consoleAPICalled' || message.method === 'Runtime.exceptionThrown',
      async message => message.method === 'Runtime.consoleAPICalled'
        ? this.consoleEvent(message.params)
        : this.exceptionEvent(message.params),
    )
  }

  /**
   * Subscribe to native Console and exception events.
   * @param listener - Connection-local event consumer.
   * @returns A disposer removing the consumer.
   */
  subscribe(listener: (event: RuntimeConsoleBackendEvent<RuntimeBackendObjectHandle>) => void): () => void {
    return this.events.subscribe(listener)
  }

  async clear(): Promise<void> {
    await this.target.request('Runtime.discardConsoleEntries', {})
  }

  /** Release the native notification subscription. */
  close(): void {
    this.events.close()
  }

  private async consoleEvent(
    params: Readonly<Record<string, unknown>> | undefined,
  ): Promise<RuntimeConsoleBackendEvent<RuntimeBackendObjectHandle> | undefined> {
    const type = params?.type
    const args = params?.args
    const timestamp = params?.timestamp
    const stackTrace = params?.stackTrace
    if (!CONSOLE_TYPES.has(type as RuntimeConsoleType) || !Array.isArray(args) || typeof timestamp !== 'number') return undefined
    return {
      type: 'console-api',
      event: {
        type: type as RuntimeConsoleType,
        arguments: await Promise.all(args.map(value => this.runtime.remoteObject(value))),
        timestamp,
        ...(typeof params?.executionContextId === 'number' ? { contextId: params.executionContextId } : {}),
        ...(isNativeRecord(stackTrace) ? { stackTrace: this.runtime.stackTrace(stackTrace) } : {}),
      },
    }
  }

  private async exceptionEvent(
    params: Readonly<Record<string, unknown>> | undefined,
  ): Promise<RuntimeConsoleBackendEvent<RuntimeBackendObjectHandle> | undefined> {
    const timestamp = params?.timestamp
    const exceptionDetails = params?.exceptionDetails
    const contextId = params?.executionContextId
    if (typeof timestamp !== 'number' || exceptionDetails === undefined) return undefined
    return {
      type: 'exception',
      event: {
        timestamp,
        ...(typeof contextId === 'number' ? { contextId } : {}),
        details: await this.runtime.exceptionDetails(exceptionDetails),
      },
    }
  }
}
