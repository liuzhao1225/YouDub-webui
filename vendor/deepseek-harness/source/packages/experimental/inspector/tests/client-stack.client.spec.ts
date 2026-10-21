import { describe, expect, it } from 'vitest'
import { parseClientStack } from '../src/client/cdp/stack.ts'
import { inspectorId } from '../src/shared/bridge/ids.ts'

describe('Client stack projection', () => {
  it('normalizes browser line numbers and associates known source URLs', () => {
    const key = inspectorId<'RuntimeScriptKey'>('client-bundle', 'scriptKey')
    const stack = parseClientStack([
      'Error',
      '    at capture (http://client.test/client.js?rev=1:10:4)',
      '    at http://client.test/app.js:20:8',
    ].join('\n'), url => url.includes('/client.js') ? key : undefined, 0)
    expect(stack).toEqual({
      callFrames: [
        {
          functionName: 'capture',
          scriptKey: key,
          url: 'http://client.test/client.js?rev=1',
          lineNumber: 9,
          columnNumber: 3,
        },
        {
          functionName: '',
          url: 'http://client.test/app.js',
          lineNumber: 19,
          columnNumber: 7,
        },
      ],
    })
  })
})
