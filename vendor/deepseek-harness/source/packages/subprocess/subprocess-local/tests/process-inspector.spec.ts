import { describe, expect, it } from 'vitest'
import { linuxProcessGroupHasLiveMembers, parseProcStat } from '../src/process-inspector.ts'
import type { ProcessInspectorInternals } from '../src/process-inspector.ts'

function stat(
  pid: number,
  pgrp: number,
  session: number,
  tpgid: number,
  started: string,
  parentPid = 1,
  state = 'S',
  ttyDevice = 99,
): string {
  const rest = [state, String(parentPid), String(pgrp), String(session), String(ttyDevice), String(tpgid)]
  while (rest.length < 19) rest.push('0')
  rest.push(started)
  return `${pid} (command with space) ${rest.join(' ')}`
}

function fakeInternals() {
  const files = new Map<string, string>()
  const dirs = new Map<string, string[]>()
  const internals: ProcessInspectorInternals = {
    readFile(path) {
      const value = files.get(path)
      if (value === undefined) throw new Error('missing ' + path)
      return value
    },
    readDir(path) {
      const value = dirs.get(path)
      if (value === undefined) throw new Error('missing ' + path)
      return value
    },
  }
  return { internals, files, dirs }
}

describe('Linux process-group liveness', () => {
  it('parses identity fields and rejects malformed process rows', () => {
    expect(parseProcStat('bad')).toBeUndefined()
    expect(parseProcStat('1 () ')).toBeUndefined()
    expect(parseProcStat('1 () S')).toBeUndefined()
    expect(parseProcStat(stat(10, 20, 30, 40, '500', 1, 'SS'))).toBeUndefined()
    expect(parseProcStat(stat(10, 20, 30, 40, '500'))).toEqual({ pid: 10, parentPid: 1, pgrp: 20, session: 30, state: 'S', ttyDevice: 99, tpgid: 40, started: '500' })
  })

  it('treats zombie-only process groups as quiescent and fails closed when unobservable', () => {
    const fake = fakeInternals()
    expect(linuxProcessGroupHasLiveMembers(77, fake.internals)).toBeUndefined()

    fake.dirs.set('/proc', ['self', '10', '11', '12'])
    fake.files.set('/proc/10/stat', stat(10, 77, 10, -1, '500', 1, 'Z'))
    fake.files.set('/proc/11/stat', stat(11, 77, 10, -1, '501', 1, 'X'))
    fake.files.set('/proc/12/stat', stat(12, 88, 12, -1, '502'))
    expect(linuxProcessGroupHasLiveMembers(77, fake.internals)).toBe(false)
    expect(linuxProcessGroupHasLiveMembers(99, fake.internals)).toBeUndefined()

    fake.files.set('/proc/11/stat', stat(11, 77, 10, -1, '501'))
    expect(linuxProcessGroupHasLiveMembers(77, fake.internals)).toBe(true)
  })
})
