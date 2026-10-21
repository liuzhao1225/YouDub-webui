/** Client-face Runtime behavior. */

import { afterEach, describe, expect, it } from 'vitest'
import { ClientRuntimeExecutor } from '../src/client/cdp/runtime.ts'
import type {
  ClientRuntimeCommand,
  ClientRuntimeRequestFrame,
  ClientRuntimeResult,
} from '../src/shared/bridge/messages/runtime/index.ts'
import {
  inspectorId,
} from '../src/shared/bridge/ids.ts'

const sourceId = inspectorId<'InspectorSourceId'>('client-test', 'sourceId')
const generation = inspectorId<'InspectorSourceGeneration'>('generation-test', 'generation')
const sessionId = inspectorId<'ClientRuntimeSessionId'>('session-test', 'sessionId')
const secondSessionId = inspectorId<'ClientRuntimeSessionId'>('session-second', 'sessionId')

describe('Client Runtime executor', () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, '__clientRuntimeFixture')
    Reflect.deleteProperty(globalThis, '__clientRuntimeGetterCalls')
  })

  it('retains RemoteObjects, reads descriptors lazily, calls functions, and releases groups', async () => {
    Reflect.set(globalThis, '__clientRuntimeGetterCalls', 0)
    const fixture = {
      value: 4,
      get dangerous(): number {
        const calls = Number(Reflect.get(globalThis, '__clientRuntimeGetterCalls'))
        Reflect.set(globalThis, '__clientRuntimeGetterCalls', calls + 1)
        return 99
      },
    }
    Object.defineProperty(fixture, Symbol.toStringTag, {
      get() {
        const calls = Number(Reflect.get(globalThis, '__clientRuntimeGetterCalls'))
        Reflect.set(globalThis, '__clientRuntimeGetterCalls', calls + 1)
        return 'DangerousTag'
      },
    })
    Reflect.set(globalThis, '__clientRuntimeFixture', fixture)
    const runtime = new ClientRuntimeExecutor({
      maxObjectsPerSession: 100,
      maxPropertiesPerResult: 100,
      maxResponseBytes: 32_768,
    })

    const evaluated = success(await runtime.execute(frame({
      op: 'evaluate',
      expression: 'globalThis.__clientRuntimeFixture',
      objectGroup: 'console',
      generatePreview: true,
    })), 'evaluate')
    const handle = evaluated.completion.result.object?.handle
    if (handle === undefined) throw new Error('evaluate did not return a Client object handle')

    const properties = success(await runtime.execute(frame({
      op: 'get-properties',
      handle,
      ownProperties: true,
    })), 'get-properties')
    const valueProperty = properties.properties.find(property => property.name === 'value')
    const getterProperty = properties.properties.find(property => property.name === 'dangerous')
    expect(valueProperty?.value).toMatchObject({ descriptor: { type: 'number', value: 4 } })
    expect(getterProperty?.get).toMatchObject({ descriptor: { type: 'function' } })
    expect(Reflect.get(globalThis, '__clientRuntimeGetterCalls')).toBe(0)

    const called = success(await runtime.execute(frame({
      op: 'call-function',
      functionDeclaration: 'function (increment) { return this.value + increment }',
      receiver: handle,
      arguments: [{ kind: 'value', value: 3 }],
      returnByValue: true,
    })), 'call-function')
    expect(called.completion.result).toMatchObject({ descriptor: { type: 'number', value: 7 } })

    success(await runtime.execute(frame({ op: 'release-object-group', objectGroup: 'console' })), 'release-object-group')
    const released = await runtime.execute(frame({ op: 'get-properties', handle }))
    expect(released.outcome).toEqual({
      ok: false,
      error: { code: 'object-not-found', message: 'Client RemoteObject was released' },
    })
  })

  it('keeps evaluated exceptions separate from transport failures', async () => {
    const runtime = new ClientRuntimeExecutor({
      maxObjectsPerSession: 100,
      maxPropertiesPerResult: 100,
      maxResponseBytes: 32_768,
    })
    const result = success(await runtime.execute(frame({
      op: 'evaluate',
      expression: 'throw new TypeError("bad value")',
    })), 'evaluate')
    expect(result.completion.exceptionDetails).toMatchObject({
      text: 'Uncaught',
      exception: { descriptor: { type: 'object', subtype: 'error' } },
    })
    expect(result.completion.result).toMatchObject({ descriptor: { type: 'object', subtype: 'error' } })
  })

  it('preserves non-JSON primitives and reports bounded async execution failures', async () => {
    const runtime = new ClientRuntimeExecutor({
      maxObjectsPerSession: 100,
      maxPropertiesPerResult: 100,
      maxResponseBytes: 32_768,
    })
    const values = [
      ['NaN', { descriptor: { type: 'number', unserializableValue: 'NaN' } }],
      ['-0', { descriptor: { type: 'number', unserializableValue: '-0' } }],
      ['12n', { descriptor: { type: 'bigint', unserializableValue: '12n' } }],
      ['null', { descriptor: { type: 'object', subtype: 'null', value: null } }],
    ] as const
    for (const [expression, expected] of values) {
      const result = success(await runtime.execute(frame({ op: 'evaluate', expression })), 'evaluate')
      expect(result.completion.result).toMatchObject(expected)
    }
    const fn = success(await runtime.execute(frame({
      op: 'evaluate',
      expression: '(value) => value',
      generatePreview: true,
    })), 'evaluate')
    expect(fn.completion.result).toMatchObject({ descriptor: { type: 'function' } })
    expect(fn.completion.result.descriptor.preview).toBeUndefined()

    const timedOut = await runtime.execute(frame({
      op: 'evaluate',
      expression: 'new Promise(() => {})',
      awaitPromise: true,
      timeoutMs: 1,
    }))
    expect(timedOut.outcome).toMatchObject({ ok: false, error: { code: 'timeout' } })
  })

  it('rolls back only objects allocated by the failing concurrent request', async () => {
    const runtime = new ClientRuntimeExecutor({
      maxObjectsPerSession: 100,
      maxPropertiesPerResult: 100,
      maxResponseBytes: 32_768,
    })
    const blocked = runtime.execute(frame({
      op: 'evaluate',
      expression: 'new Promise(() => {})',
      awaitPromise: true,
      timeoutMs: 10,
    }))
    const completed = success(await runtime.execute(frame({
      op: 'evaluate',
      expression: '({ retainedByConcurrentRequest: true })',
    })), 'evaluate')
    const handle = completed.completion.result.object?.handle
    if (handle === undefined) throw new Error('concurrent evaluation did not retain an object')

    await expect(blocked).resolves.toMatchObject({ outcome: { ok: false, error: { code: 'timeout' } } })
    const properties = success(await runtime.execute(frame({
      op: 'get-properties',
      handle,
      ownProperties: true,
    })), 'get-properties')
    expect(properties.properties.find(property => property.name === 'retainedByConcurrentRequest')?.value)
      .toMatchObject({ descriptor: { value: true } })
  })

  it('rolls back a canceled function call instead of returning its cancellation as a JavaScript exception', async () => {
    const runtime = new ClientRuntimeExecutor({
      maxObjectsPerSession: 1,
      maxPropertiesPerResult: 100,
      maxResponseBytes: 32_768,
    })
    const controller = new AbortController()
    const pending = runtime.execute(frame({
      op: 'call-function',
      functionDeclaration: 'function () { return new Promise(() => {}) }',
      awaitPromise: true,
    }), controller.signal)
    controller.abort()

    await expect(pending).resolves.toMatchObject({ outcome: { ok: false, error: { code: 'timeout' } } })
    await expect(runtime.execute(frame({
      op: 'evaluate',
      expression: '({ retainedAfterCancellation: true })',
    }))).resolves.toMatchObject({ outcome: { ok: true } })
  })

  it('keeps response handles provisional until the Worker accepts or cancels them', async () => {
    const runtime = new ClientRuntimeExecutor({
      maxObjectsPerSession: 2,
      maxPropertiesPerResult: 100,
      maxResponseBytes: 32_768,
    })
    const canceledFrame = frame({ op: 'evaluate', expression: '({ canceled: true })' })
    const canceled = success(await runtime.execute(canceledFrame, undefined, true), 'evaluate')
    const canceledHandle = canceled.completion.result.object?.handle
    if (canceledHandle === undefined) throw new Error('deferred response did not retain an object')
    runtime.cancel(canceledFrame.sessionId, canceledFrame.requestId)
    expect((await runtime.execute(frame({ op: 'get-properties', handle: canceledHandle }))).outcome)
      .toMatchObject({ ok: false, error: { code: 'object-not-found' } })

    const acceptedFrame = frame({ op: 'evaluate', expression: '({ accepted: true })' })
    const accepted = success(await runtime.execute(acceptedFrame, undefined, true), 'evaluate')
    const acceptedHandle = accepted.completion.result.object?.handle
    if (acceptedHandle === undefined) throw new Error('deferred response did not retain an object')
    runtime.acknowledge(acceptedFrame.sessionId, acceptedFrame.requestId)
    const properties = success(await runtime.execute(frame({
      op: 'get-properties',
      handle: acceptedHandle,
      ownProperties: true,
    })), 'get-properties')
    expect(properties.properties.find(property => property.name === 'accepted')?.value)
      .toMatchObject({ descriptor: { value: true } })
  })

  it('rejects oversized by-value results before they enter the source transport', async () => {
    const runtime = new ClientRuntimeExecutor({
      maxObjectsPerSession: 100,
      maxPropertiesPerResult: 100,
      maxResponseBytes: 256,
    })
    const response = await runtime.execute(frame({
      op: 'evaluate',
      expression: '"x".repeat(1000)',
      returnByValue: true,
    }))
    expect(response.outcome).toMatchObject({ ok: false, error: { code: 'result-too-large' } })
  })

  it('drops every retained handle when its DevTools Runtime session closes', async () => {
    const runtime = new ClientRuntimeExecutor({
      maxObjectsPerSession: 100,
      maxPropertiesPerResult: 100,
      maxResponseBytes: 32_768,
    })
    const evaluated = success(await runtime.execute(frame({
      op: 'evaluate',
      expression: '({ retained: true })',
    })), 'evaluate')
    const handle = evaluated.completion.result.object?.handle
    if (handle === undefined) throw new Error('evaluate did not return a Client object handle')

    runtime.closeSession(sessionId)
    const response = await runtime.execute(frame({ op: 'get-properties', handle }))
    expect(response.outcome).toMatchObject({ ok: false, error: { code: 'object-not-found' } })
  })

  it('serializes Console objects into isolated DevTools sessions', async () => {
    const runtime = new ClientRuntimeExecutor({
      maxObjectsPerSession: 100,
      maxPropertiesPerResult: 100,
      maxResponseBytes: 32_768,
    })
    const value = { owner: 'console' }
    const first = runtime.consoleEvent(sessionId, 'log', [value], 12)
    const second = runtime.consoleEvent(secondSessionId, 'log', [value], 12)
    if (first?.type !== 'console-api' || second?.type !== 'console-api') {
      throw new Error('Console event was unexpectedly dropped')
    }
    const firstHandle = first.event.arguments[0]?.object?.handle
    const secondHandle = second.event.arguments[0]?.object?.handle
    if (firstHandle === undefined || secondHandle === undefined) throw new Error('Console object was not retained')

    runtime.releaseObjectGroup(sessionId, 'console')
    expect((await runtime.execute(frame({ op: 'get-properties', handle: firstHandle }))).outcome)
      .toMatchObject({ ok: false, error: { code: 'object-not-found' } })
    const properties = success(await runtime.execute(
      frame({ op: 'get-properties', handle: secondHandle }, secondSessionId),
    ), 'get-properties').properties
    expect(properties.find(property => property.name === 'owner')?.value?.descriptor.value).toBe('console')
  })
})

let nextRequestId = 0

function frame(
  command: ClientRuntimeCommand,
  owner: ClientRuntimeRequestFrame['sessionId'] = sessionId,
): ClientRuntimeRequestFrame {
  return {
    v: 0,
    t: 'client-runtime/request',
    sourceId,
    generation,
    sessionId: owner,
    requestId: inspectorId<'ClientRuntimeRequestId'>(`request-${String(++nextRequestId)}`, 'requestId'),
    command,
  }
}

function success<Operation extends ClientRuntimeResult['op']>(
  response: Awaited<ReturnType<ClientRuntimeExecutor['execute']>>,
  operation: Operation,
): Extract<ClientRuntimeResult, { op: Operation }> {
  if (!response.outcome.ok) throw new Error(response.outcome.error.message)
  if (response.outcome.result.op !== operation) throw new Error('unexpected Client Runtime result')
  return response.outcome.result as Extract<ClientRuntimeResult, { op: Operation }>
}
