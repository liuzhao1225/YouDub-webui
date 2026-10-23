/** API-key route availability follows the configured credential. */
import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import * as DeepSeek from '@deepseek-ai/dsh-llm-deepseek-api-key'
import { assemble } from './assemble.ts'

const contexts: Context[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
})

async function harness() {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(DeepSeek, {})
  return ctx
}

it('rejects a missing API key without network access', async () => {
  vi.stubEnv('DEEPSEEK_API_KEY', '')
  const ctx = await harness()
  const fetch = vi.spyOn(globalThis, 'fetch')
  const result = await assemble(ctx, { provider: 'deepseek-official', model: 'deepseek-v4-flash', messages: [] })
  expect(result.finish).toMatchObject({ kind: 'error', failure: { code: 'MISSING_CREDENTIAL' } })
  expect(fetch).not.toHaveBeenCalled()
})

it('lists models only while the configured API key is present', async () => {
  vi.stubEnv('DEEPSEEK_API_KEY', '')
  const ctx = await harness()
  expect(await ctx.llm.listModels('deepseek-official')).toEqual([])
  vi.stubEnv('DEEPSEEK_API_KEY', 'fixture-key')
  expect(await ctx.llm.listModels('deepseek-official')).not.toHaveLength(0)
  vi.stubEnv('DEEPSEEK_API_KEY', '')
  expect(await ctx.llm.listModels('deepseek-official')).toEqual([])
})
