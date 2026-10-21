import { describe, expect, it } from 'vitest'
import { inspectorId } from '../src/shared/bridge/ids.ts'
import { ClientScriptIdentity } from '../src/worker/realms/client/scripts.ts'
import { clientConsoleEvent } from '../src/worker/realms/client/values.ts'

describe('Worker Client stack projection', () => {
  it('uses one script key in Client Console and Sources projections', () => {
    const localKey = inspectorId<'RuntimeScriptKey'>('client-bundle', 'scriptKey')
    const scripts = new ClientScriptIdentity(-7)
    const projected = clientConsoleEvent({
      type: 'console-api',
      event: {
        type: 'log',
        arguments: [],
        timestamp: 1,
        stackTrace: {
          callFrames: [{
            functionName: 'apply',
            scriptKey: localKey,
            url: 'http://client.test/client.js',
            lineNumber: 1,
            columnNumber: 2,
          }],
        },
      },
    }, scriptKey => scripts.toRuntime(scriptKey))
    if (projected.type !== 'console-api') throw new Error('unexpected exception event')
    expect(projected.event.stackTrace?.callFrames[0]?.scriptKey).toBe(scripts.toRuntime(localKey))
  })
})
