import { describe, expect, it, vi } from 'vitest'
import { createUserMessage, CONTEXT_WINDOW_EXCEEDED_CODE, EMPTY_RESPONSE_CODE, createMessage } from '@deepseek-ai/dsh-llm'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import type { AssistantMessage, AssistantMessageEvent, Usage } from '@earendil-works/pi-ai'
import { transformMessages } from '@earendil-works/pi-ai/api/transform-messages'
import { getBuiltinModels } from '@earendil-works/pi-ai/providers/all'
import { toPiContext } from '../src/context.ts'
import { mapStopReason, mapUsage, toStreamChunks } from '../src/stream.ts'

function usage(input = 0, output = 0, cacheRead = 0, cacheWrite = 0): Usage {
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    totalTokens: input + output + cacheRead + cacheWrite,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  }
}

function assistant(overrides: Partial<AssistantMessage> = {}): AssistantMessage {
  return {
    role: 'assistant',
    content: [],
    api: 'openai-completions',
    provider: 'deepseek',
    model: 'deepseek-v4-flash',
    usage: usage(),
    stopReason: 'stop',
    timestamp: 0,
    ...overrides,
  }
}

async function* feed(...events: AssistantMessageEvent[]): AsyncGenerator<AssistantMessageEvent> {
  for (const event of events) yield event
}

async function collect(stream: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const out: StreamChunk[] = []
  for await (const chunk of stream) out.push(chunk)
  return out
}

describe('toPiContext', () => {
  it('maps system prompt and user text', () => {
    const context = toPiContext({
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      system: 'be helpful',
      messages: [createUserMessage({
        content: [{ type: 'text', text: 'hi' }],
        source: { kind: 'test' },
      })],
    })
    expect(context).toEqual({
      systemPrompt: 'be helpful',
      messages: [{ role: 'user', content: 'hi', timestamp: 0 }],
    })
  })

  it('omits empty tools and absent system prompt', () => {
    const context = toPiContext({ provider: 'deepseek', model: 'm', messages: [], tools: [] })
    expect(context).toEqual({ messages: [] })
  })
})

describe('toStreamChunks', () => {
  it.each([
    ['claude-haiku-4-5', 'claude-haiku-4-5-20251001'],
    ['claude-opus-5', 'kimi-for-coding'],
    ['claude-opus-5', undefined],
  ])('retains signed thinking for Anthropic request %s reported as %s', async (requestedModel, reportedModel) => {
    const native = assistant({
      api: 'anthropic-messages', provider: 'anthropic', model: requestedModel,
      ...reportedModel === undefined ? {} : { responseModel: reportedModel },
      providerThinkingLevel: 'high',
      content: [{ type: 'thinking', thinking: 'reason', thinkingSignature: 'signed' }],
    })
    const chunks = await collect(toStreamChunks(feed(
      { type: 'done', reason: 'stop', message: native },
    ), undefined, undefined, requestedModel))
    const finish = chunks.find(chunk => chunk.type === 'finish')
    const replayState: unknown = JSON.parse(JSON.stringify(finish?.replayState))
    expect(replayState).toMatchObject({ response: { model: requestedModel } })
    if (reportedModel === undefined) {
      expect(finish?.replayState?.response).not.toHaveProperty('responseModel')
    } else {
      expect(replayState).toMatchObject({ response: { responseModel: reportedModel } })
    }
    const onDegrade = vi.fn()
    const context = toPiContext({
      provider: 'anthropic', model: requestedModel,
      messages: [createMessage({
        role: 'assistant', content: [{ type: 'reasoning', text: 'reason' }],
        source: { kind: 'model', provider: 'anthropic', model: requestedModel, replayState },
      })],
    }, undefined, onDegrade)
    expect(onDegrade).not.toHaveBeenCalled()
    expect(context.messages[0]).toMatchObject({
      api: 'anthropic-messages', model: requestedModel, providerThinkingLevel: 'high',
      content: native.content,
    })
    const requested = getBuiltinModels('anthropic').find(model => model.id === requestedModel)
    if (requested === undefined) throw new Error('missing Anthropic catalog model')
    expect(transformMessages(context.messages, requested)[0]).toMatchObject({ content: native.content })
    expect(transformMessages(context.messages, { ...requested, id: 'other-model' })[0]).toMatchObject({
      content: [{ type: 'text', text: 'reason' }],
    })
  })

  it('maps text events to text blocks', async () => {
    const done = assistant({ content: [{ type: 'text', text: 'hi' }], usage: usage(3, 2) })
    const chunks = await collect(toStreamChunks(feed(
      { type: 'start', partial: assistant() },
      { type: 'text_start', contentIndex: 0, partial: assistant() },
      { type: 'text_delta', contentIndex: 0, delta: 'hi', partial: assistant() },
      { type: 'text_end', contentIndex: 0, content: 'hi', partial: assistant() },
      { type: 'done', reason: 'stop', message: done },
    )))
    expect(chunks).toEqual([
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: 'hi' },
      { type: 'block-end', index: 0, block: { type: 'text', text: 'hi' } },
      { type: 'usage', usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 } },
      {
        type: 'finish',
        reason: { kind: 'stop' },
        replayState: {
          response: {
            kind: 'pi-ai',
            version: 2,
            api: 'openai-completions',
            provider: 'deepseek',
            model: 'deepseek-v4-flash',
            stopReason: 'stop',
          },
          blocks: [{ type: 'text' }],
        },
      },
    ])
  })

  it('maps thinking events to reasoning blocks', async () => {
    const chunks = await collect(toStreamChunks(feed(
      { type: 'thinking_start', contentIndex: 0, partial: assistant() },
      { type: 'thinking_delta', contentIndex: 0, delta: 'mull', partial: assistant() },
      { type: 'thinking_end', contentIndex: 0, content: 'mull', partial: assistant() },
      { type: 'done', reason: 'stop', message: assistant() },
    )))
    expect(chunks.slice(0, 3)).toEqual([
      { type: 'block-start', index: 0, blockType: 'reasoning' },
      { type: 'reasoning-delta', index: 0, text: 'mull' },
      { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'mull' } },
    ])
  })

  it('maps error events to error finish chunks (in-stream error style)', async () => {
    const error = assistant({ stopReason: 'error', errorMessage: 'boom', usage: usage(1, 0) })
    const chunks = await collect(toStreamChunks(feed(
      { type: 'error', reason: 'error', error },
    )))
    expect(chunks).toEqual([
      { type: 'usage', usage: { inputTokens: 1, outputTokens: 0, totalTokens: 1 } },
      { type: 'finish', reason: { kind: 'error', failure: { message: 'boom', code: 'PI_AI_ERROR' } } },
    ])
  })

  it('maps aborted error events to aborted finish', async () => {
    const error = assistant({ stopReason: 'aborted' })
    const chunks = await collect(toStreamChunks(feed({ type: 'error', reason: 'aborted', error })))
    expect(chunks.at(-1)).toEqual({
      type: 'finish',
      reason: { kind: 'aborted', failure: { message: 'pi-ai stream aborted', code: 'ABORTED' } },
    })
  })

  it('rejects a stream that ends without done or error', async () => {
    await expect(collect(toStreamChunks(feed({ type: 'start', partial: assistant() }))))
      .rejects.toThrow(/without done\/error/)
  })

  it('preserves an unknown SDK iterator Error exactly', async () => {
    const original = Object.assign(new Error('SDK transport exploded'), { code: 'ECONNRESET' })
    async function* failedSdkStream(): AsyncGenerator<AssistantMessageEvent> {
      throw original
    }

    await expect(collect(toStreamChunks(failedSdkStream()))).rejects.toBe(original)
  })
})

describe('mapStopReason / mapUsage', () => {
  it.each([
    ['stop', { kind: 'stop' }],
    ['length', { kind: 'max-tokens' }],
    ['toolUse', { kind: 'tool-calls' }],
    ['pending', {
      kind: 'error',
      failure: { message: 'pi-ai stream for model "deepseek-v4-flash" ended pending', code: 'PI_AI_ERROR' },
    }],
    ['deferred', {
      kind: 'error',
      failure: { message: 'pi-ai deferred response for model "deepseek-v4-flash" is not supported', code: 'PI_AI_ERROR' },
    }],
    ['aborted', { kind: 'aborted', failure: { message: 'pi-ai stream aborted', code: 'ABORTED' } }],
  ] as const)('maps %s', (stopReason, expected) => {
    expect(mapStopReason(assistant({ stopReason, content: [{ type: 'text', text: 'ok' }] }))).toEqual(expected)
  })

  it('classifies a completed stop with no content as an EMPTY_RESPONSE error', () => {
    expect(mapStopReason(assistant({ stopReason: 'stop' }))).toEqual({
      kind: 'error',
      failure: {
        message: 'model "deepseek-v4-flash" returned a completed response with no content',
        code: EMPTY_RESPONSE_CODE,
      },
    })
  })

  it('keeps a thinking-only stop successful (any block counts as content)', () => {
    expect(mapStopReason(assistant({ stopReason: 'stop', content: [{ type: 'thinking', thinking: 'mull' }] })))
      .toEqual({ kind: 'stop' })
  })

  it('defaults the error message when pi-ai omits it', () => {
    expect(mapStopReason(assistant({ stopReason: 'error' })))
      .toEqual({ kind: 'error', failure: { message: 'pi-ai stream error', code: 'PI_AI_ERROR' } })
  })

  it('maps routable HTTP-ish error messages to stable codes', () => {
    expect(mapStopReason(assistant({ stopReason: 'error', errorMessage: 'HTTP 401: bad key' })))
      .toMatchObject({ kind: 'error', failure: { code: 'AUTH' } })
    expect(mapStopReason(assistant({ stopReason: 'error', errorMessage: 'HTTP 429: rate limit' })))
      .toMatchObject({ kind: 'error', failure: { code: 'RATE_LIMIT' } })
    expect(mapStopReason(assistant({ stopReason: 'error', errorMessage: 'HTTP 429: insufficient_quota' })))
      .toMatchObject({ kind: 'error', failure: { code: 'QUOTA' } })
    expect(mapStopReason(assistant({
      stopReason: 'error',
      errorMessage: 'OpenAI API error (429): You exceeded your current quota, please check your plan and billing details.',
    }))).toMatchObject({ kind: 'error', failure: { code: 'QUOTA' } })
    expect(mapStopReason(assistant({ stopReason: 'error', errorMessage: 'HTTP 500: backend down' })))
      .toMatchObject({ kind: 'error', failure: { code: 'SERVER' } })
    expect(mapStopReason(assistant({ stopReason: 'error', errorMessage: 'provider timed out' })))
      .toMatchObject({ kind: 'error', failure: { code: 'TIMEOUT' } })
    expect(mapStopReason(assistant({ stopReason: 'error', errorMessage: 'ECONNRESET socket closed' })))
      .toMatchObject({ kind: 'error', failure: { code: 'TRANSPORT' } })
    expect(mapStopReason(assistant({
      stopReason: 'error',
      errorMessage: 'HTTP 400: input exceeds the model context window limit',
    }))).toMatchObject({ kind: 'error', failure: { code: CONTEXT_WINDOW_EXCEEDED_CODE } })
    expect(mapStopReason(assistant({
      stopReason: 'error',
      errorMessage: 'HTTP 400: request too large for model context',
    }))).toMatchObject({ kind: 'error', failure: { code: CONTEXT_WINDOW_EXCEEDED_CODE } })
    expect(mapStopReason(assistant({
      stopReason: 'error',
      errorMessage: 'HTTP 400: invalid input: temperature exceeds maximum allowed value',
    }))).toMatchObject({ kind: 'error', failure: { code: 'INVALID_REQUEST' } })
    expect(mapStopReason(assistant({ stopReason: 'error', errorMessage: 'HTTP 413: Payload Too Large' })))
      .toMatchObject({ kind: 'error', failure: { code: 'INVALID_REQUEST' } })
    expect(mapStopReason(assistant({
      stopReason: 'error',
      errorMessage: 'Failed to buffer the request body: length limit exceeded',
    }))).toMatchObject({ kind: 'error', failure: { code: 'INVALID_REQUEST' } })
    expect(mapStopReason(assistant({
      stopReason: 'error',
      errorMessage: 'vector length limit exceeded',
    }))).toMatchObject({ kind: 'error', failure: { code: 'PI_AI_ERROR' } })
  })

  it.each([
    'other side closed',
    'HTTP2 request did not get a response',
    'WebSocket closed unexpectedly',
    // undici flattens a mid-stream socket drop to this bare word (its SocketError
    // cause is discarded upstream before it reaches us).
    'terminated',
    'Premature close',
    // pi-ai's per-provider throws when the wire closes before the terminal event.
    'Anthropic stream ended before message_stop',
    'OpenAI Responses stream ended before a terminal response event',
    'openrouter stream ended without a terminal event',
    'Stream ended without finish_reason',
  ])('maps pi-ai transport wording %j', (errorMessage) => {
    expect(mapStopReason(assistant({ stopReason: 'error', errorMessage })))
      .toMatchObject({ kind: 'error', failure: { code: 'TRANSPORT' } })
  })

  it('uses pi-ai provider-specific overflow classification without losing rate-limit exclusions', () => {
    expect(mapStopReason(assistant({
      stopReason: 'error',
      errorMessage: 'prompt is too long: 213462 tokens > 200000 maximum',
    }))).toMatchObject({ kind: 'error', failure: { code: CONTEXT_WINDOW_EXCEEDED_CODE } })
    expect(mapStopReason(assistant({
      stopReason: 'error',
      errorMessage: 'ThrottlingException: Too many tokens, rate limit reached',
    }))).toMatchObject({ kind: 'error', failure: { code: 'RATE_LIMIT' } })
  })

  it('uses the resolved context window for silent and length-stop overflows', () => {
    // Non-empty content keeps the no-window branch on the successful stop path
    // (an empty stop is EMPTY_RESPONSE, covered above); overflow wins over both.
    const silent = assistant({ stopReason: 'stop', usage: usage(101, 0), content: [{ type: 'text', text: 'x' }] })
    expect(mapStopReason(silent)).toEqual({ kind: 'stop' })
    expect(mapStopReason(silent, 100)).toEqual({
      kind: 'error',
      failure: {
        message: 'pi-ai detected context overflow for model "deepseek-v4-flash"',
        code: CONTEXT_WINDOW_EXCEEDED_CODE,
      },
    })

    const truncated = assistant({ stopReason: 'length', usage: usage(80, 0, 19) })
    expect(mapStopReason(truncated)).toEqual({ kind: 'max-tokens' })
    expect(mapStopReason(truncated, 100)).toMatchObject({
      kind: 'error',
      failure: { code: CONTEXT_WINDOW_EXCEEDED_CODE },
    })
  })

  it('maps cache fields only when nonzero', () => {
    expect(mapUsage(usage(10, 5, 8, 2))).toEqual({
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 25,
      cacheReadTokens: 8,
      cacheWriteTokens: 2,
    })
    expect(mapUsage(usage(10, 5))).toEqual({ inputTokens: 10, outputTokens: 5, totalTokens: 15 })
  })
})
