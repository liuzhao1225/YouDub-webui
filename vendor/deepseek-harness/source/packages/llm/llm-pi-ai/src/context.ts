/** Convert YouDub text requests into the provider SDK context. */
import { assertTextRequest } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, RequestMessage } from '@deepseek-ai/dsh-llm'
import type { Context as PiContext, Message as PiMessage } from '@earendil-works/pi-ai'

function flattenText(message: RequestMessage): string {
  return message.content.map(block => block.text).join('')
}

export function toPiContext(options: GenerateOptions): PiContext {
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
    messages.push({ role: message.role, content, timestamp: 0 })
  }
  return { ...systemPrompt ? { systemPrompt } : {}, messages }
}
