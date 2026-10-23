/** Events consumed by YouDub settings and plugin management. */
import type {} from '@deepseek-ai/dsh-credentials/types'
import type {} from '@deepseek-ai/dsh-llm/types'
import type {} from '@deepseek-ai/dsh-plugin-manager/types'
import type {} from '@deepseek-ai/dsh-settings/types'
import type { TypertForwardableEventEntry } from '@deepseek-ai/dsh-typert-protocol'
export const API_REMOTE_FORWARDED_EVENTS = [
  { event: 'credentials/record-updated', mode: 'emit' },
  { event: 'credentials/reference-updated', mode: 'emit' },
  { event: 'llm/adapters-updated', mode: 'emit' },
  { event: 'plugin-manager/changed', mode: 'emit' },
  { event: 'plugin-manager/install-log', mode: 'emit' },
  { event: 'plugin-manager/install-state', mode: 'emit' },
  { event: 'settings/document-updated', mode: 'emit' },
] as const satisfies readonly TypertForwardableEventEntry[]
