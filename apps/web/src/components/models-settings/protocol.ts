const labels: Record<string, string> = {
  'openai-completions': 'OpenAI Chat Completions',
  'openai-responses': 'OpenAI Responses',
  'anthropic-messages': 'Anthropic Messages',
}
export const protocolLabel = (protocol: string) => labels[protocol] ?? protocol
