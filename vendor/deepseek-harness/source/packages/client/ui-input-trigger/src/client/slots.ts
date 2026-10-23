/** Slash-menu props for the Conversation-owned input overlay. */
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InputTriggerCrumb, PickAction } from '../types.ts'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { MenuState } from '../core/contract.ts'

/** Injected business face of the MenuView overlay entry (copy rides the standard locale seat, not this face). */
export interface MenuViewInjected {
  /** The service's menu state store (read-only here; MenuView subscribes). */
  menu: SnapshotStore<MenuState>
  /** Crumbs published per source for the open menu; sources without a header never appear. */
  headers: SnapshotStore<ReadonlyMap<string, readonly InputTriggerCrumb[]>>
  /**
   * Pointer pick routed back through the service pipeline.
   * @param source - source (group) name.
   * @param index - candidate index within the group.
   * @param action - settling pick (default) or the candidate's drill action.
   */
  onPick: (source: string, index: number, action?: PickAction) => void
  /**
   * Pointer hover routed to the shared highlight (pointer and keyboard drive
   * one highlight — last input wins).
   * @param source - source (group) name.
   * @param index - candidate index within the group.
   */
  onHover: (source: string, index: number) => void
  /**
   * Pointer pick on one header crumb, routed back through the source's drill path.
   * @param source - source (group) name.
   * @param index - crumb index within that source's published header.
   */
  onCrumb: (source: string, index: number) => void
  /** Dismiss the menu (external pointer outside the composer area). */
  onDismiss: () => void
}
