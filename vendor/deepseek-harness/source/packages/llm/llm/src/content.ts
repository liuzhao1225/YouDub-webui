/** Text request boundary shared by the service and direct adapters. */
import { LlmError } from './index.ts'
import type { GenerateOptions } from './types.ts'

export function assertTextRequest(options: GenerateOptions): void {
  const retired = options as GenerateOptions & { tools?: unknown; toolHistory?: unknown }
  if (retired.tools !== undefined || retired.toolHistory !== undefined) {
    throw new LlmError('YouDub model requests do not support tools or tool history', 'UNSUPPORTED_CONTENT')
  }
  for (const message of options.messages) {
    if (message.role !== 'system' && message.role !== 'user') {
      throw new LlmError('YouDub model requests only support system and user text', 'UNSUPPORTED_CONTENT')
    }
    if (message.content.some(block => block.type !== 'text' || typeof block.text !== 'string')) {
      throw new LlmError('YouDub model requests only support text content', 'UNSUPPORTED_CONTENT')
    }
  }
}
