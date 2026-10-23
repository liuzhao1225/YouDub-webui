/**
 * Pure-type outlet of the session-projection Service Definition: the one projection type
 * table, importable from client aggregates without dragging the host-side
 * cordis Context merges of the package root (dsh-agent → dsh-session). Domain
 * packages may declare-merge through either the package root or this outlet —
 * re-export preserves symbol identity, so both land on the same table.
 *
 * @module @deepseek-ai/dsh-session-projection/types
 */

/**
 * The merge-extensible client projection table shared by wire blocks, client
 * cells, and React hooks. Domain packages merge their client-visible key here;
 * values are wire-JSON whole values. How a value is rendered is the slot
 * system's business, never this layer's.
 */
export interface SessionProjectionMap {}

/**
 * The merge-extensible host fold-state table. Each client-visible key also
 * appears in {@link SessionProjectionMap}; host-only keys appear only here.
 * Values must be plain JSON so the projection cache can persist them.
 */
export interface SessionProjectionStateMap {}
