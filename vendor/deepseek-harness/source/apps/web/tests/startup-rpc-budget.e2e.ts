// Cold boot may issue at most two settings/describe calls regardless of client
// plugin count. No model call or replay fixture is involved.
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { newEnglishPage } from './support.ts'

/** One eager read plus one first-connection reset closes the pre-subscription commit window. */
const DESCRIBE_BUDGET = 2

let scaffold: WebScaffold
let browser: Browser
let page: Page

beforeAll(async () => {
  scaffold = await launchWebScaffold()
  browser = await chromium.launch()
})

afterAll(async () => {
  await page?.close()
  await browser?.close()
  await scaffold?.close()
})

describe('startup RPC budget', () => {
  it('keeps cold-boot settings.describe at the mirror count', async () => {
    page = await newEnglishPage(browser)
    watchConsole(page)
    const calls: string[] = []
    page.on('request', (request) => {
      const url = new URL(request.url())
      if (url.pathname.startsWith('/api/')) calls.push(url.pathname.slice('/api/'.length))
    })
    await page.goto(scaffold.authenticatedUrl)
    // Boot settles when the workspace picker is interactive; the trailing wait
    // absorbs the first-connection reset wave the budget must include.
    await page.getByRole('textbox', { name: 'Choose workspace' }).waitFor({ timeout: 30_000 })
    await page.waitForTimeout(3000)
    const describeCount = calls.filter(method => method === 'settings/describe').length
    expect(describeCount, `startup /api calls:\n${calls.join('\n')}`).toBe(DESCRIBE_BUDGET)
  })
})
