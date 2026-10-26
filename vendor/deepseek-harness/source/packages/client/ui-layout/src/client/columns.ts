/** Sidebar drag clamp floor. */
export const SIDEBAR_MIN = 264
/** Sidebar drag clamp ceiling. */
export const SIDEBAR_MAX = 420
/** Sidebar width before any user drag. */
export const SIDEBAR_DEFAULT = 280
/** Closed-sidebar rail: a 24px icon column between 16px horizontal paddings. */
export const SIDEBAR_COLLAPSED = 56
/** Viewport width below which the sidebar auto-collapses to the rail (deepsuite
 * LG breakpoint); a manual toggle below it re-expands over the squeezed center
 * (stores.ts narrowExpanded). */
export const SIDEBAR_AUTO_COLLAPSE = 1024
/**
 * Clamp the sidebar width into its contract range.
 * @param px - requested width.
 * @returns the clamped width.
 */
export function clampWidth(px: number): number {
  return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(px)))
}
