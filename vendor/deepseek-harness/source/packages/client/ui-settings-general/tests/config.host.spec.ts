import { it } from 'vitest'
import * as HostPlugin from '../src/index.ts'
import { omitsGeneratedPage } from '../../../settings/settings/tests/live-config.ts'

it('keeps its own instance off the generated Settings pages', () => omitsGeneratedPage(ctx => ctx.plugin(HostPlugin)))
