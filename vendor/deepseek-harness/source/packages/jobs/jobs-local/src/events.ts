/**
 * Event routing for the local registry: every commit dispatches once to
 * each listener with containment.
 * @module @deepseek-ai/dsh-jobs-local/events
 */

import type { Context } from '@deepseek-ai/cordis'
import type { JobEvent, JobEventListener } from '@deepseek-ai/dsh-jobs'

/** Dispatch committed events to listeners owned by their Cordis contexts. */
export class JobEventHub {
  private readonly subscriptions = new Set<{ listener: JobEventListener }>()

  /**
   * @param warn - sink for a listener's contained failure.
   */
  constructor(
    private readonly warn: (message: string) => void,
  ) {}

  /**
   * Register one listener as an effect of `ctx`.
   * @param ctx - the subscribing context that owns the effect.
   * @param listener - receives each matching event.
   * @returns disposer that unregisters the listener.
   */
  subscribe(ctx: Context, listener: JobEventListener): () => void {
    const subscription = { listener }
    const dispose = ctx.effect(() => {
      this.subscriptions.add(subscription)
      return () => { this.subscriptions.delete(subscription) }
    }, 'jobs.events.subscribe()')
    // oxlint-disable-next-line typescript/no-misused-promises -- exact synchronous disposer preserves Cordis effect identity
    return dispose
  }

  /**
   * Deliver one event to every matching subscription, containing each
   * listener so an observer cannot break the commit already made.
   * @param event - the event to deliver.
   */
  emit(event: JobEvent): void {
    for (const { listener } of this.subscriptions) this.deliver(listener, event)
  }

  private deliver(listener: JobEventListener, event: JobEvent): void {
    try {
      listener(event)
    } catch (error: unknown) {
      this.warn(`jobs: event listener threw on ${event.type}: ${String(error)}`)
    }
  }
}
