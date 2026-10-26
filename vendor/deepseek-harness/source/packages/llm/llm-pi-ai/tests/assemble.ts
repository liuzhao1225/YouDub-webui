/** Collect the actual Harness stream for provider boundary assertions. */
import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock, FinishReason, GenerateOptions, TokenUsage } from '@deepseek-ai/dsh-llm'

export async function assemble(ctx: Context, options: Omit<GenerateOptions, 'provider'> & { provider?: string }) {
  const content: ContentBlock[] = []
  let usage: TokenUsage | undefined
  let finish: FinishReason | undefined
  for await (const chunk of ctx.llm.stream({ provider: 'deepseek', ...options })) {
    if (chunk.type === 'block-end') content.push(chunk.block)
    if (chunk.type === 'usage') usage = chunk.usage
    if (chunk.type === 'finish') finish = chunk.reason
  }
  if (finish === undefined) throw new Error('Harness stream ended without a finish chunk')
  return { message: { content }, usage, finish }
}
