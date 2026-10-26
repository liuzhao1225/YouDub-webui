import type { LlmResolvedModelInfo } from '@deepseek-ai/dsh-llm'
import type LlmRuntime from '@deepseek-ai/dsh-llm'

/** Observe the validated model from the same preparation path used by callers. */
export async function inspectModel(llm: LlmRuntime, provider: string, model: string, signal?: AbortSignal): Promise<LlmResolvedModelInfo> {
  let captured!: LlmResolvedModelInfo
  await llm.prepareCall({ provider, model }, signal, (controls, info) => {
    captured = info
    return controls
  })
  return captured
}
