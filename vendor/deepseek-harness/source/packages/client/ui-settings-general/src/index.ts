/** Settings shell Host entry; product onboarding is owned by YouDub. */
import type {} from '@deepseek-ai/dsh-settings'
import type { Context } from '@deepseek-ai/cordis'

/** Keep this infrastructure plugin out of generated settings pages. */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (child) => { child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)) })
}
