/** Convert YouDub text requests into the provider SDK context. */
import { assertTextRequest } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, RequestMessage } from '@deepseek-ai/dsh-llm'
import type { Api, Context as PiContext, Message as PiMessage, Model } from '@earendil-works/pi-ai'

function flattenText(message: RequestMessage): string {
  return message.content.map(block => block.text).join('')
}

export function toPiContext(options: GenerateOptions, model?: Model<Api>): PiContext {
  assertTextRequest(options)
  const text = [options.system]
  let start = 0
  for (const message of options.messages) {
    if (message.role !== 'system') break
    text.push(flattenText(message))
    start++
  }
  const systemPrompt = text.filter(Boolean).join('\n\n')
  const messages: PiMessage[] = []
  for (const message of options.messages.slice(start)) {
    const content = flattenText(message)
    if (message.role === 'system' && content.length === 0) continue
    if (message.role === 'assistant') {
      if (!model) throw new Error('Assistant history requires a resolved model.')
      messages.push({
        role: 'assistant', content: [{ type: 'text', text: content }], timestamp: 0,
        api: model.api, provider: model.provider, model: model.id, stopReason: 'stop',
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      })
    } else messages.push({ role: message.role, content, timestamp: 0 })
  }
  return { ...systemPrompt ? { systemPrompt } : {}, messages }
}
