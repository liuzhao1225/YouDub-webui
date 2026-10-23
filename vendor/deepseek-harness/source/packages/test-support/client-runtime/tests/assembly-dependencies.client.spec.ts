/** Real bundle dependency closures activate their requested client plugins without extra roster rows. */
import { FiberState } from '@deepseek-ai/cordis'
import { describe, expect, vi } from 'vitest'
import { createClientTest, webApp } from '../src/assembly/index.ts'

const HMR = '@deepseek-ai/dsh-client-hmr'
const MODULES = '@deepseek-ai/dsh-client-modules'
const LOCALE = '@deepseek-ai/dsh-client-locale'
const SETTINGS = '@deepseek-ai/dsh-client-ui-settings'
const hmrRoster = webApp.closure([HMR])
const localeRoster = webApp.closure([LOCALE])
const hmrTest = createClientTest({ roster: hmrRoster }, { awaitConnected: false })
const localeTest = createClientTest({ roster: localeRoster })

describe('bundle dependency closures', () => {
  hmrTest('activates HMR with its declared module provider and no Connection', async ({ start }) => {
    expect(hmrRoster.rows.map(row => row.name)).toContain(MODULES)
    const client = await start()
    const entry = [...client.ctx.loader.entries()].find(row => row.options.name === HMR)
    expect(entry?.fiber?.state).toBe(FiberState.ACTIVE)
    expect(client.ctx.get('modules')).toBeDefined()
    expect(client.ctx.get('connection')).toBeUndefined()
  }, 60_000)

  localeTest('activates Locale with its declared configuration forms provider', async ({ mock, start }) => {
    expect(localeRoster.rows.map(row => row.name)).toContain(SETTINGS)
    const client = await start()
    const entry = [...client.ctx.loader.entries()].find(row => row.options.name === LOCALE)
    expect(entry?.fiber?.state).toBe(FiberState.ACTIVE)
    expect(client.ctx.get('configForms')).toBeDefined()
    await client.ctx.configForms.describe().ensure()
    await vi.waitFor(() => {
      expect(client.ctx.locale.getSnapshot().locales.length).toBeGreaterThan(0)
      expect(mock.log.calls('settings/describe').length).toBeGreaterThan(0)
    })
  }, 60_000)
})
