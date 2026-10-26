/** Linux process-group liveness used by ordinary subprocess teardown. */

import { readFileSync, readdirSync } from 'node:fs'

/** Injectable process-table reads for process-group liveness. */
export interface ProcessInspectorInternals {
  readFile(path: string): string
  readDir(path: string): string[]
}

const DEFAULT_INTERNALS: ProcessInspectorInternals = {
  readFile: path => readFileSync(path, 'utf8'),
  readDir: path => readdirSync(path),
}

interface ProcStat {
  pid: number
  parentPid: number
  pgrp: number
  session: number
  state: string
  ttyDevice: number
  tpgid: number
  started: string
}

/**
 * Parse fields used from Linux `/proc/<pid>/stat`, including parenthesized comm text.
 * @param text - complete stat line.
 * @returns Parsed identity/group fields, or undefined for malformed input.
 */
export function parseProcStat(text: string): ProcStat | undefined {
  const open = text.indexOf('(')
  const close = text.lastIndexOf(')')
  if (open <= 0 || close <= open) return undefined
  const pid = Number(text.slice(0, open).trim())
  const rest = text.slice(close + 2).trim().split(/\s+/)
  const state = rest[0] || ''
  const parentPid = Number(rest[1])
  const pgrp = Number(rest[2])
  const session = Number(rest[3])
  const ttyDevice = Number(rest[4])
  const tpgid = Number(rest[5])
  const started = rest[19]
  if (![pid, parentPid, pgrp, session, ttyDevice, tpgid].every(Number.isSafeInteger)
    || state.length !== 1 || started === undefined) return undefined
  return { pid, parentPid, pgrp, session, state, ttyDevice, tpgid, started }
}

function readLinuxStat(internals: ProcessInspectorInternals, pid: number): ProcStat | undefined {
  try {
    return parseProcStat(internals.readFile(`/proc/${pid}/stat`))
  } catch (_unreadableProcEntry) {
    return undefined
  }
}

/**
 * Report whether a Linux process group has an executing member. `false`
 * means the group contains only zombie/dead entries; `undefined` means the
 * process table could not prove either outcome.
 * @param processGroupId - POSIX process-group id to inspect.
 * @param internals - injectable process-table operations.
 * @returns Live-member presence, or `undefined` when unavailable/absent.
 */
export function linuxProcessGroupHasLiveMembers(
  processGroupId: number,
  internals: ProcessInspectorInternals = DEFAULT_INTERNALS,
): boolean | undefined {
  let entries: string[]
  try {
    entries = internals.readDir('/proc')
  } catch (_unreadableProcDirectory) {
    return undefined
  }
  let matched = false
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue
    const stat = readLinuxStat(internals, Number(entry))
    if (stat?.pgrp !== processGroupId) continue
    matched = true
    if (!/^[ZXx]$/.test(stat.state)) return true
  }
  return matched ? false : undefined
}
