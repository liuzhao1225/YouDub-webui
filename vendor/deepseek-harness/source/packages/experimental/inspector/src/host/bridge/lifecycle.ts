/** Failure containment and shutdown coordination for the Inspector Worker. */

import type { Worker } from 'node:worker_threads'
import type { InspectorHostControl, InspectorWorkerControl } from '../../shared/bridge/messages/control.ts'
import { parseInspectorWorkerControl } from '../../shared/bridge/control-codec.ts'

/** Tracks Worker termination without removing the listener that contains runtime errors. */
export class InspectorWorkerLifecycle {
  private readonly exitResolution = Promise.withResolvers<number>()
  private readonly failureResolution = Promise.withResolvers<Error>()
  private failure: Error | undefined
  private running = false
  private expectedExit = false
  private notified = false
  private onUnexpectedExit: ((error: Error) => void) | undefined
  private exitCodeValue: number | undefined

  /** Worker exit code once its `exit` event has fired. */
  get exitCode(): number | undefined {
    return this.exitCodeValue
  }

  constructor(private readonly worker: Worker) {
    worker.on('error', (error) => {
      this.failure ??= error
      this.failureResolution.resolve(error)
      this.notifyUnexpectedExit()
    })
    worker.once('exit', (code) => {
      this.exitCodeValue = code
      this.exitResolution.resolve(code)
      this.notifyUnexpectedExit()
    })
  }

  /**
   * Wait for the validated ready frame while also observing startup failure and exit.
   * @param timeoutMs - Readiness deadline in milliseconds.
   * @returns The Worker's bound endpoint fields.
   */
  async waitForReady(timeoutMs: number): Promise<Extract<InspectorWorkerControl, { type: 'ready' }>> {
    let timer: NodeJS.Timeout | undefined
    let onMessage: ((value: unknown) => void) | undefined
    const message = new Promise<Extract<InspectorWorkerControl, { type: 'ready' }>>((resolve, reject) => {
      onMessage = (value: unknown): void => {
        let control: InspectorWorkerControl
        try {
          control = parseInspectorWorkerControl(value)
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)))
          return
        }
        if (control.type === 'ready') resolve(control)
        else if (control.type === 'failure') reject(new Error(`inspector Worker failed: ${control.message}`))
      }
      timer = setTimeout(() => {
        reject(new Error(`inspector Worker did not become ready within ${String(timeoutMs)}ms`))
      }, timeoutMs)
      this.worker.on('message', onMessage)
    })
    try {
      return await Promise.race([
        message,
        this.failureResolution.promise.then((error) => { throw error }),
        this.exitResolution.promise.then((code) => {
          throw new Error(`inspector Worker exited before readiness (code ${String(code)})`)
        }),
      ])
    } finally {
      if (timer !== undefined) clearTimeout(timer)
      if (onMessage !== undefined) this.worker.off('message', onMessage)
    }
  }

  /**
   * Begin reporting an unexpected runtime exit through one contained callback.
   * @param listener - Failure observer that must not throw.
   */
  markRunning(listener: (error: Error) => void): void {
    this.running = true
    this.onUnexpectedExit = listener
    this.notifyUnexpectedExit()
  }

  /** Mark subsequent Worker termination as owner-requested. */
  expectExit(): void {
    this.expectedExit = true
  }

  /** Terminate the Worker during failed initialization. */
  async terminate(): Promise<void> {
    this.expectExit()
    if (this.exitCodeValue === undefined) await this.worker.terminate()
  }

  /**
   * Request graceful shutdown and terminate after the deadline.
   * @param timeoutMs - Grace period before forced termination.
   */
  async stop(timeoutMs: number): Promise<void> {
    this.expectExit()
    if (this.exitCodeValue !== undefined) return
    this.worker.postMessage({ type: 'shutdown' } satisfies InspectorHostControl)
    let timer: NodeJS.Timeout | undefined
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => { resolve('timeout') }, timeoutMs)
    })
    const outcome = await Promise.race([
      this.exitResolution.promise.then(() => 'exited' as const),
      timeout,
    ])
    if (timer !== undefined) clearTimeout(timer)
    if (outcome === 'exited') return
    await this.worker.terminate()
    throw new Error(`inspector Worker did not stop within ${String(timeoutMs)}ms and was terminated`)
  }

  private notifyUnexpectedExit(): void {
    if (!this.running || this.expectedExit || this.notified || this.exitCodeValue === undefined) return
    this.notified = true
    this.onUnexpectedExit?.(this.failure ?? new Error(
      `inspector Worker exited unexpectedly with code ${String(this.exitCodeValue)}`,
    ))
  }
}
