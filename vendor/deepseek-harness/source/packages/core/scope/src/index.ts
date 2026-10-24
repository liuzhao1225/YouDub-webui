/** Cordis child-context lifetime used by connected peers. */

import type { Context, Fiber } from '@deepseek-ai/cordis'

/** A minted registration scope and its quiescent disposal boundaries. */
export interface Scope {
  /** Context through which scope-owned registrations are made. */
  ctx: Context
  /** Exact Cordis disposer, used when nesting this scope in an ordered composite effect. */
  rawDispose: () => Promise<void> | void
  /** Dispose every scope-owned registration; racing calls await the same completion. */
  dispose(): Promise<void>
}

/** Follow a Cordis fiber through asynchronous teardown even if its raw disposer was already claimed. */
async function quiesceFiber(fiber: Fiber): Promise<void> {
  await Promise.resolve(fiber.dispose())
  while (fiber.inertia !== undefined) await fiber.inertia
}

/** Shared no-op plugin used as the backing scope fiber. */
function scope(): void {}

/** Mint a child context whose registrations share one awaited disposal boundary. */
export function createScope(ctx: Context): Scope {
  const fiber = ctx.plugin(scope)
  let disposing: Promise<void> | undefined
  return {
    ctx: fiber.ctx,
    rawDispose: fiber.dispose,
    dispose: () => (disposing ??= quiesceFiber(fiber)),
  }
}
