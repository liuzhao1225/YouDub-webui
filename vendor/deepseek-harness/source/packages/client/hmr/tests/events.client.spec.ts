import { describe, expect, it } from 'vitest'
import { parsePluginsEventFrame } from '../src/events.ts'

describe('plugin event wire parser', () => {
  it('accepts complete rebuilt and graph frames', () => {
    expect(parsePluginsEventFrame({ type: 'rebuilt', id: 'plugin', rev: 'next' })).toEqual({
      kind: 'frame',
      frame: { type: 'rebuilt', id: 'plugin', rev: 'next' },
    })
    const graph = { rev: 'graph', entries: [], batches: [] }
    expect(parsePluginsEventFrame({ type: 'graph', graph })).toEqual({
      kind: 'frame',
      frame: { type: 'graph', graph },
    })
  })

  it('separates forward-compatible unknown types from malformed known frames', () => {
    expect(parsePluginsEventFrame({ type: 'future', payload: true })).toEqual({ kind: 'unknown' })
    for (const value of [null, [], {}, { type: 'rebuilt', id: 'plugin' }, { type: 'graph', graph: null }]) {
      expect(parsePluginsEventFrame(value)).toEqual({ kind: 'invalid' })
    }
  })
})
