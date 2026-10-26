import type { CommonKey } from './zh.ts'

/** en base dictionary for the common namespace, checked complete against the zh key set. */
export const en = {
  'cancel': 'Cancel',
  'close': 'Close',
  'retry': 'Retry',
  'loading': 'Loading…',
  'edit': 'Edit',
  'brand.localBuild': 'YouDub Local Build',
} satisfies Record<CommonKey, string>
