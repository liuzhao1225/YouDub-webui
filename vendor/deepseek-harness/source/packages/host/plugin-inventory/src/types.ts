import type { Branded } from '@deepseek-ai/dsh-brand'
import type { PluginLocalizedMeta } from '@deepseek-ai/dsh-package-manifest'

/** Stable Loader-tree identity of one configured plugin entry. */
export type PluginEntryId = Branded<'PluginEntryId'>

/** Lifecycle state of an entry's root Fiber, or null when it has no live root Fiber. */
export type PluginFiberPhase =
  | 'pending'
  | 'loading'
  | 'active'
  | 'failed'
  | 'unloading'
  | null

/** One non-group Loader entry exposed to trusted clients. */
export interface PluginInventoryEntry {
  readonly entryId: PluginEntryId
  /** Exact module specifier imported by the Loader entry. */
  readonly moduleName: string
  /** Local package display metadata, independent of whether the entry is enabled. */
  readonly meta?: PluginLocalizedMeta
  /** Effective Loader enablement, including disabled ancestor groups. */
  readonly enabled: boolean
  readonly fiberPhase: PluginFiberPhase
}

/** Point-in-time inventory returned by the plugin inventory Remote. */
export interface PluginInventorySnapshot {
  /** Whether this Host exposes persistent current-profile management. */
  readonly managementAvailable?: boolean
  readonly entries: readonly PluginInventoryEntry[]
}
