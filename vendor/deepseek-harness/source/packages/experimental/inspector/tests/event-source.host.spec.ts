/** Consumer-neutral Server-Sent Event parsing behavior. */

import { describe, expect, it } from 'vitest'
import { InspectorEventSourceParser } from '../src/shared/network/event-source.ts'

const encoder = new TextEncoder()

describe('InspectorEventSourceParser', () => {
  it('preserves parser state across chunks, CRLF boundaries, and UTF-8 boundaries', () => {
    const parser = new InspectorEventSourceParser()
    expect(parser.push(encoder.encode(': ignored\rid:first\revent: update\rdata: one\r'))).toEqual([])

    const unicode = encoder.encode('\ndata: two 你\r\n\r\n')
    const split = unicode.indexOf(0xe4) + 1
    expect(parser.push(unicode.subarray(0, split))).toEqual([])
    expect(parser.push(unicode.subarray(split))).toEqual([{
      eventName: 'update',
      eventId: 'first',
      data: 'one\ntwo 你',
    }])
  })

  it('retains valid ids, ignores comments and unknown fields, and emits empty data', () => {
    const parser = new InspectorEventSourceParser()
    expect(parser.push(encoder.encode('retry: 1000\nunknown\n\n'))).toEqual([])
    expect(parser.push(encoder.encode('id: stable\ndata: value\n\nid: bad\0id\ndata:\n\n'))).toEqual([
      { eventName: 'message', eventId: 'stable', data: 'value' },
      { eventName: 'message', eventId: 'stable', data: '' },
    ])
  })
})
