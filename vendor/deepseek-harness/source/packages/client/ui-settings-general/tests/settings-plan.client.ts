/** The settings shell consumes slots supplied by the product sidebar. */
import { ClientRoster, webApp, type AssemblyPlan } from '@deepseek-ai/dsh-client-test-runtime/src/assembly/index.ts'

import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'

export const SIDEBAR = '@test/settings-sidebar'
export const settingsPlan: AssemblyPlan = {
  roster: ClientRoster.of([...webApp.rows, {
    name: SIDEBAR, inject: ['@deepseek-ai/dsh-client-ui-layout'], immediately: false,
  }]),
  provide: {
    [SIDEBAR]: {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('sidebar', () => ctx.slots.register({
          name: 'sidebar', children: {
            'sidebar.settings': { kind: 'single', scope: 'root' },
            'sidebar.toggle.badge': { kind: 'single', scope: 'root' },
          },
        }, (_props: PropsRenderSlots<'sidebar.settings' | 'sidebar.toggle.badge'>) => null))
      },
    },
  },
}
