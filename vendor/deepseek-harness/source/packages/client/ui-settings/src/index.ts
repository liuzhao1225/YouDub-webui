/** Host registration for the shared configuration form service. */
import type {} from '@deepseek-ai/dsh-settings'

import type { Volatile, Context } from '@deepseek-ai/cordis'

import z from '@deepseek-ai/schemastery'

/** Runtime preferences projected to the browser. */
export interface Config {
  /** Historical preference accepted without exposing the retired coding view. */
  enabled: Volatile<boolean>
}

/** Live preferences projected to the browser. */
export const Config = z.object({
  enabled: z.boolean().default(true).volatile(),
})

/** Host preferences are consumed through the configuration form projection.
 * @param ctx Plugin context used for optional settings presentation.
 */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (child) => { child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)) })
}
