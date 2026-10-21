/**
 * The worker's process table. A browser worker cannot fork, so the
 * `node:child_process` shim keeps its own table: one entry per running
 * command, with the pid `process.kill` and the subprocess service's tree
 * bookkeeping address it by.
 *
 * Kept apart from both consumers because they need it from opposite sides —
 * the shim registers entries, the `process` global signals them.
 * @module @deepseek-ai/dsh-experimental-webworker-runtime/src/node/process-table
 */

import type { RunningProcess } from '../shell/process/host.ts'

/** One running command, as the table tracks it. */
export interface WorkerProcessEntry {
  /** Identifier handed out to the host tree; unique for the worker's lifetime. */
  readonly pid: number
  /** The first signal delivered, which decides how the process reports its death. */
  signal: NodeJS.Signals | undefined
  /** The started command, attached once it exists; signals reach it through this. */
  process: RunningProcess | undefined
}

const entries = new Map<number, WorkerProcessEntry>()

// Pid 1 is the worker host itself (`process.pid`), so commands start above it.
let lastPid = 1

/**
 * Reserve one pid before its command starts, so a handle can report it
 * synchronously.
 * @returns the new table entry, still without its process.
 */
export function registerProcess(): WorkerProcessEntry {
  lastPid += 1
  const entry: WorkerProcessEntry = { pid: lastPid, signal: undefined, process: undefined }
  entries.set(entry.pid, entry)
  return entry
}

/**
 * Drop one entry once its command has settled.
 * @param pid - the entry's pid.
 */
export function releaseProcess(pid: number): void {
  entries.delete(pid)
}

/**
 * Whether a command with this pid is still running.
 * @param pid - pid to look up; a negative value addresses the group, which here
 * holds exactly the one process that leads it.
 * @returns true while the entry is in the table.
 */
export function processAlive(pid: number): boolean {
  return entries.has(Math.abs(pid))
}

/**
 * Deliver a signal to one running command.
 *
 * `SIGKILL` stops the command whatever it is doing; every other signal asks it
 * to stop at its next command boundary. That distinction is real only for a
 * worker-backed process — see {@link RunningProcess.destroy}.
 * @param pid - pid or negative process-group id.
 * @param signal - the signal name to record and deliver.
 * @returns true when an entry received it, false when no such process exists.
 */
export function signalProcess(pid: number, signal: NodeJS.Signals): boolean {
  const entry = entries.get(Math.abs(pid))
  if (entry === undefined) return false
  entry.signal ??= signal
  if (signal === 'SIGKILL') entry.process?.destroy()
  else entry.process?.interrupt()
  return true
}
