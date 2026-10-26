import { inspectModel } from './model-info.ts'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, {
  GenerateOptions,
  HarnessError,
  isContextWindowExceededError,
  isQuotaExceededError,
  LlmAdapter,
  LlmError,
  ProviderRequestId,
  ReasoningEffortId,
  resolveRetryPolicy,
  StreamChunk,
} from '@deepseek-ai/dsh-llm'
import type {
  LlmCallConfig,
  ConfigureCall,
  LlmModelContext,
  LlmModelInfo,
  LlmModelReasoningInfo,
  LlmProviderInfo,
  LlmResolvedModelInfo,
} from '@deepseek-ai/dsh-llm'

class ScriptedAdapter extends LlmAdapter {
  constructor(private script: StreamChunk[]) {
    super()
  }

  async * stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    yield * this.script
  }
}

class RecordingAdapter extends ScriptedAdapter {
  lastOptions: GenerateOptions | undefined

  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.lastOptions = options
    yield * super.stream(options)
  }
}

class ThrowingAdapter extends LlmAdapter {
  constructor(private readonly failure: Error) {
    super()
  }

  stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    throw this.failure
  }
}

class CatalogAdapter extends ScriptedAdapter {
  constructor(
    private readonly provider: LlmProviderInfo,
    private readonly models: readonly LlmModelInfo[],
    private readonly contexts: Readonly<Record<string, LlmModelContext>> = {},
    private readonly reasoning: Readonly<Record<string, LlmModelReasoningInfo>> = {},
    private readonly defaultMaxTokens: Readonly<Record<string, number>> = {},
  ) {
    super(SCRIPT)
  }

  override providerInfo(_provider: string): LlmProviderInfo {
    return this.provider
  }

  override listModels(_provider: string): Promise<readonly LlmModelInfo[]> {
    return Promise.resolve(this.models)
  }

  override resolveModel(
    provider: string,
    model: string,
  ): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({
      provider,
      id: model,
      name: model,
      ...this.contexts[model] === undefined ? {} : { context: this.contexts[model] },
      ...this.reasoning[model] === undefined ? {} : { reasoning: this.reasoning[model] },
      ...this.defaultMaxTokens[model] === undefined ? {} : { defaultMaxTokens: this.defaultMaxTokens[model] },
    })
  }
}

const SCRIPT: StreamChunk[] = [
  { type: 'block-start', index: 0, blockType: 'text' },
  { type: 'text-delta', index: 0, text: 'hi' },
  { type: 'block-end', index: 0, block: { type: 'text', text: 'hi' } },
  { type: 'finish', reason: { kind: 'stop' } },
]

async function collect(stream: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

async function runtimeContext(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  return ctx
}

describe('LlmRuntime', () => {
  it.each([
    { messages: [{ role: 'user', content: [{ type: 'image' }] }] },
    { messages: [{ role: 'user', content: [{ type: 'file' }] }] },
    { messages: [{ role: 'assistant', content: [{ type: 'text', text: 'old answer' }] }] },
    { messages: [{ role: 'tool', content: [{ type: 'text', text: 'tool output' }] }] },
    { messages: [{ role: 'developer', content: [] }] },
    { messages: [], tools: [] },
    { messages: [], toolHistory: { tools: [], updates: [] } },
  ])('rejects retired request content before adapter dispatch: %j', async input => {
    const ctx = await runtimeContext()
    const adapter = new RecordingAdapter(SCRIPT)
    ctx.llm.registerAdapter(['route'], adapter)
    const chunks = []
    for await (const chunk of ctx.llm.stream({ provider: 'route', model: 'm', ...input } as never)) chunks.push(chunk)
    expect(chunks).toEqual([expect.objectContaining({ type: 'finish', reason: expect.objectContaining({
      kind: 'error', failure: expect.objectContaining({ code: 'UNSUPPORTED_CONTENT' }),
    }) })])
    expect(adapter.lastOptions).toBeUndefined()
  })

  it('recognizes structured and model-capacity context-window overflow details', () => {
    expect(isContextWindowExceededError('context_length_exceeded maximum context length')).toBe(true)
    expect(isContextWindowExceededError('context-window-overflowed')).toBe(true)
    expect(isContextWindowExceededError('This model maximum context length is 128000 tokens')).toBe(true)
    expect(isContextWindowExceededError('input is too long for this model')).toBe(true)
    expect(isContextWindowExceededError('request too large for model context')).toBe(true)
    expect(isContextWindowExceededError('input exceeds the model context window limit')).toBe(true)
  })

  it('does not mistake unrelated input validation for context-window overflow', () => {
    expect(isContextWindowExceededError('invalid request: malformed tool arguments')).toBe(false)
    expect(isContextWindowExceededError('invalid input: temperature exceeds maximum allowed value')).toBe(false)
    expect(isContextWindowExceededError('input exceeds maximum allowed value')).toBe(false)
    expect(isContextWindowExceededError('context window size must be positive')).toBe(false)
  })

  it('distinguishes exhausted account quota from transient rate limiting', () => {
    for (const detail of [
      'insufficient_quota',
      'account balance depleted',
      'usage-limit-exceeded',
      'out of credits',
      'OpenAI API error (429): You exceeded your current quota, please check your plan and billing details.',
    ]) expect(isQuotaExceededError(detail)).toBe(true)
    expect(isQuotaExceededError('HTTP 429: rate limit reached')).toBe(false)
    expect(isQuotaExceededError('quota resets in one minute')).toBe(false)
  })

  it('routes stream() to the registered adapter', async () => {
    const ctx = await runtimeContext()
    ctx.llm.registerAdapter(['test-provider'], new ScriptedAdapter(SCRIPT))

    const chunks: StreamChunk[] = []
    for await (const chunk of ctx.llm.stream({ provider: 'test-provider', model: 'test-model', messages: [] })) chunks.push(chunk)
    expect(chunks).toEqual(SCRIPT)
  })

  it('trusts the immutable message creation boundary for direct calls', async () => {
    const ctx = await runtimeContext()
    const adapter = new RecordingAdapter(SCRIPT)
    ctx.llm.registerAdapter(['test-provider'], adapter)
    const message = { role: 'user' as const, content: [{ type: 'text' as const, text: 'hello' }] }

    for await (const _chunk of ctx.llm.stream({
      provider: 'test-provider',
      model: 'test-model',
      messages: [message],
    })) { /* drain */ }

    expect(adapter.lastOptions?.messages[0]).toBe(message)
  })

  it('captures provider-owned retry policy at registration and defaults omission', async () => {
    const configured = resolveRetryPolicy({ mode: 'always' }, 'test retryPolicy')
    const adapter = new class extends ScriptedAdapter {
      override providerRetryPolicy(provider: string) {
        return provider === 'configured' ? configured : undefined
      }
    }(SCRIPT)
    const ctx = await runtimeContext()
    ctx.llm.registerAdapter(['configured', 'defaulted'], adapter)

    expect(ctx.llm.providerRetryPolicy('configured')).toBe(configured)
    expect(ctx.llm.providerRetryPolicy('defaulted')).toMatchObject({
      mode: 'normal',
      maxRetries: 5,
    })
    expect(() => ctx.llm.providerRetryPolicy('missing')).toThrow(
      expect.objectContaining({ code: 'NO_ADAPTER' }),
    )
  })

  it('keeps a prepared registration and retry policy after route replacement', async () => {
    const oldPolicy = resolveRetryPolicy({ mode: 'always' }, 'old retryPolicy')
    const newPolicy = resolveRetryPolicy({ mode: 'normal', maxRetries: 0 }, 'new retryPolicy')
    const oldFailure = new LlmError('old route failed', 'AUTH')
    const ctx = await runtimeContext()
    const disposeOld = ctx.llm.registerAdapter(['route'], new class extends ThrowingAdapter {
      override providerRetryPolicy(): typeof oldPolicy {
        return oldPolicy
      }
    }(oldFailure))
    const prepared = await ctx.llm.prepareCall({ provider: 'route', model: 'model' })

    disposeOld()
    ctx.llm.registerAdapter(['route'], new class extends ScriptedAdapter {
      override providerRetryPolicy(): typeof newPolicy {
        return newPolicy
      }
    }(SCRIPT))

    const chunks = await collect(prepared.stream({ ...prepared.config, messages: [] }))
    expect(chunks.at(-1)).toEqual({
      type: 'finish',
      reason: {
        kind: 'error',
        failure: { message: 'old route failed', code: 'AUTH' },
      },
    })
    expect(prepared.retryPolicy).toBe(oldPolicy)
    expect(ctx.llm.providerRetryPolicy('route')).toBe(newPolicy)
  })

  it('normalizes an unregistered provider to a terminal failure', async () => {
    const ctx = await runtimeContext()

    const chunks = await collect(ctx.llm.stream({
      provider: 'nope',
      model: 'any-model',
      messages: [],
    }))

    const finish = chunks.at(-1)
    expect(finish).toMatchObject({
      type: 'finish',
      reason: {
        kind: 'error',
        failure: { code: 'NO_ADAPTER' },
      },
    })
    if (finish?.type !== 'finish' || finish.reason.kind !== 'error') throw new Error('expected error finish')
    expect(finish.reason.failure.message).toContain('no adapter registered')
  })

  it.each(['done', 'value'] as const)('normalizes a throwing IteratorResult.%s getter', async (field) => {
    const original = new LlmError(`${field} getter failed`, 'RESULT_GETTER_FAILED')
    const result = field === 'done' ? {} : { done: false }
    Object.defineProperty(result, field, { get: () => { throw original } })
    let cleanupLookups = 0
    const iterator: AsyncIterator<StreamChunk> = {
      next: () => Promise.resolve(result as IteratorResult<StreamChunk>),
    }
    Object.defineProperty(iterator, 'return', {
      get: () => {
        cleanupLookups += 1
        throw new Error('return getter must not run after iteration fails')
      },
    })
    const adapter = new class extends LlmAdapter {
      stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
        return { [Symbol.asyncIterator]: () => iterator }
      }
    }()
    const ctx = await runtimeContext()
    ctx.llm.registerAdapter(['test'], adapter)

    const chunks = await collect(ctx.llm.stream({
      provider: 'test',
      model: 'test',
      messages: [],
    }))

    expect(chunks.at(-1)).toEqual({
      type: 'finish',
      reason: {
        kind: 'error',
        failure: { message: `${field} getter failed`, code: 'RESULT_GETTER_FAILED' },
      },
    })
    expect(cleanupLookups).toBe(0)
  })

  it.each(['dispatch', 'iterator'] as const)('normalizes synchronous adapter %s failures', async (boundary) => {
    const original = new LlmError(`${boundary} failed`, 'BOUNDARY_FAILED')
    const adapter = new class extends LlmAdapter {
      stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
        if (boundary === 'dispatch') throw original
        return { [Symbol.asyncIterator]: () => { throw original } }
      }
    }()
    const ctx = await runtimeContext()
    ctx.llm.registerAdapter(['test'], adapter)

    const chunks = await collect(ctx.llm.stream({
      provider: 'test',
      model: 'test',
      messages: [],
    }))

    expect(chunks.at(-1)).toEqual({
      type: 'finish',
      reason: {
        kind: 'error',
        failure: { message: `${boundary} failed`, code: 'BOUNDARY_FAILED' },
      },
    })
  })

  it('preserves structured LlmError facts in the terminal failure', async () => {
    const failure = new LlmError('provider busy', 'RATE_LIMIT', {
      status: 429,
      providerRetryAfterMs: 1_500,
      requestId: ProviderRequestId('req-7'),
    })
    const ctx = await runtimeContext()
    ctx.llm.registerAdapter(['test'], new ThrowingAdapter(failure))

    const chunks = await collect(ctx.llm.stream({
      provider: 'test',
      model: 'test',
      messages: [],
    }))

    expect(chunks.at(-1)).toEqual({
      type: 'finish',
      reason: {
        kind: 'error',
        failure: {
          message: 'provider busy',
          code: 'RATE_LIMIT',
          status: 429,
          providerRetryAfterMs: 1_500,
          requestId: ProviderRequestId('req-7'),
        },
      },
    })
  })

  it('normalizes arbitrary adapter rejections without throwing them downstream', async () => {
    const adapter = new class extends LlmAdapter {
      stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
        return {
          [Symbol.asyncIterator](): AsyncIterator<StreamChunk> {
            return {
              // Third-party adapters can reject with arbitrary values.
              // oxlint-disable-next-line typescript/prefer-promise-reject-errors
              next: () => Promise.reject('plain provider failure'),
            }
          },
        }
      }
    }()
    const ctx = await runtimeContext()
    ctx.llm.registerAdapter(['test'], adapter)

    const chunks = await collect(ctx.llm.stream({
      provider: 'test',
      model: 'test',
      messages: [],
    }))

    expect(chunks.at(-1)).toEqual({
      type: 'finish',
      reason: {
        kind: 'error',
        failure: { message: 'plain provider failure', code: 'UNKNOWN' },
      },
    })
  })

  it('maps adapter failure to aborted when the request signal is aborted', async () => {
    const controller = new AbortController()
    controller.abort('cancelled')
    const ctx = await runtimeContext()
    ctx.llm.registerAdapter(['test'], new ThrowingAdapter(new Error('stopped')))

    const chunks = await collect(ctx.llm.stream({
      provider: 'test',
      model: 'test',
      messages: [],
      signal: controller.signal,
    }))

    expect(chunks.at(-1)).toMatchObject({
      type: 'finish',
      reason: { kind: 'aborted', failure: { message: 'stopped' } },
    })
  })

  it('leaves middleware and consumer failures thrown', async () => {
    const middlewareFailure = new Error('middleware failed')
    const middlewareCtx = new Context()
    await middlewareCtx.plugin(LlmRuntime)
    middlewareCtx.llm.registerAdapter(['test'], new ScriptedAdapter(SCRIPT))
    middlewareCtx.on('llm/stream', () => (async function* () {
      throw middlewareFailure
    })())
    await expect(collect(middlewareCtx.llm.stream({
      provider: 'test',
      model: 'test',
      messages: [],
    }))).rejects.toBe(middlewareFailure)

    const consumerFailure = new Error('consumer failed')
    const consumerCtx = new Context()
    await consumerCtx.plugin(LlmRuntime)
    consumerCtx.llm.registerAdapter(['test'], new ScriptedAdapter(SCRIPT))
    await expect((async () => {
      for await (const _chunk of consumerCtx.llm.stream({
        provider: 'test',
        model: 'test',
        messages: [],
      })) {
        throw consumerFailure
      }
    })()).rejects.toBe(consumerFailure)
  })

  it('awaits adapter cleanup on downstream close and leaves cleanup failure thrown', async () => {
    const cleanup = new Error('cleanup failed')
    let cleanupCalls = 0
    const adapter = new class extends LlmAdapter {
      stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
        return {
          [Symbol.asyncIterator](): AsyncIterator<StreamChunk> {
            return {
              next: () => Promise.resolve({ done: false, value: SCRIPT[0]! }),
              return: () => {
                cleanupCalls += 1
                return Promise.reject(cleanup)
              },
            }
          },
        }
      }
    }()
    const ctx = await runtimeContext()
    ctx.llm.registerAdapter(['test'], adapter)

    await expect((async () => {
      for await (const _chunk of ctx.llm.stream({
        provider: 'test',
        model: 'test',
        messages: [],
      })) break
    })()).rejects.toBe(cleanup)
    expect(cleanupCalls).toBe(1)
  })

  it('allows downstream close when an adapter iterator has no return method', async () => {
    const adapter = new class extends LlmAdapter {
      stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
        return {
          [Symbol.asyncIterator](): AsyncIterator<StreamChunk> {
            return { next: () => Promise.resolve({ done: false, value: SCRIPT[0]! }) }
          },
        }
      }
    }()
    const ctx = await runtimeContext()
    ctx.llm.registerAdapter(['test'], adapter)

    for await (const _chunk of ctx.llm.stream({ provider: 'test', model: 'test', messages: [] })) break
  })

  it('unregisters adapters when the owning fiber is disposed (HMR safety)', async () => {
    const ctx = await runtimeContext()

    const fiber = await ctx.plugin(Object.assign((inner: Context) => {
      inner.llm.registerAdapter(['scoped-model'], new ScriptedAdapter(SCRIPT))
    }, { inject: ['llm'] }))
    expect(ctx.llm.listProviders()).toEqual([{ id: 'scoped-model', name: 'scoped-model' }])

    await fiber.dispose()
    expect(ctx.llm.listProviders()).toEqual([])
  })

  it('discovers detached provider and advisory model metadata', async () => {
    const ctx = await runtimeContext()
    const provider = { id: 'catalog', name: 'Catalog Provider' }
    const model = {
      provider: 'catalog',
      id: 'fast',
      name: 'Fast',
      description: 'Low latency',
      inputModalities: ['text'] as const,
    }
    ctx.llm.registerAdapter(['catalog'], new CatalogAdapter(provider, [model]))

    const providers = ctx.llm.listProviders()
    const models = await ctx.llm.listModels('catalog')
    expect(providers).toEqual([provider])
    expect(models).toEqual([model])
    expect(models[0]!.inputModalities).not.toBe(model.inputModalities)

    providers[0]!.name = 'mutated'
    models[0]!.name = 'mutated'
    provider.name = 'source mutated'
    model.name = 'source mutated'
    expect(ctx.llm.listProviders()).toEqual([{ id: 'catalog', name: 'Catalog Provider' }])
    await expect(ctx.llm.listModels('catalog')).resolves.toEqual([{
      provider: 'catalog', id: 'fast', name: 'source mutated', description: 'Low latency', inputModalities: ['text'],
    }])
  })

  it('defaults adapters to their route name and an empty advisory model list', async () => {
    const ctx = await runtimeContext()
    ctx.llm.registerAdapter(['plain'], new ScriptedAdapter(SCRIPT))
    expect(ctx.llm.listProviders()).toEqual([{ id: 'plain', name: 'plain' }])
    await expect(ctx.llm.listModels('plain')).resolves.toEqual([])
    await expect(ctx.llm.listModels('missing')).rejects.toMatchObject({ code: 'NO_ADAPTER' })
    await expect(inspectModel(ctx.llm, 'plain', 'unlisted')).resolves.toEqual({
      provider: 'plain', id: 'unlisted', name: 'unlisted',
    })
    await expect(inspectModel(ctx.llm, 'missing', 'm')).rejects.toMatchObject({ code: 'NO_ADAPTER' })
  })

  it.each([
    [{ provider: 1, id: 'model', name: 'Model' }, 'non-string provider'],
    [{ provider: 'other', id: 'model', name: 'Model' }, 'mismatched provider'],
    [{ provider: 'route', id: 1, name: 'Model' }, 'non-string id'],
    [{ provider: 'route', id: 'other', name: 'Model' }, 'mismatched id'],
    [{ provider: 'route', id: 'model', name: 1 }, 'non-string name'],
    [{ provider: 'route', id: 'model', name: '' }, 'empty name'],
    [{ provider: 'route', id: 'model', name: 'Model', description: 1 }, 'non-string description'],
  ] as const)('rejects invalid exact model metadata (%s: %s)', async (metadata, _label) => {
    const ctx = await runtimeContext()
    const adapter = new class extends ScriptedAdapter {
      override resolveModel(): Promise<LlmResolvedModelInfo> {
        return Promise.resolve(metadata as unknown as LlmResolvedModelInfo)
      }
    }(SCRIPT)
    ctx.llm.registerAdapter(['route'], adapter)

    await expect(inspectModel(ctx.llm, 'route', 'model'))
      .rejects.toMatchObject({ code: 'INVALID_MODEL_INFO' })
  })

  it('preserves modality metadata through exact model resolution', async () => {
    const ctx = await runtimeContext()
    const adapter = new class extends ScriptedAdapter {
      override resolveModel(): Promise<LlmResolvedModelInfo> {
        return Promise.resolve({
          provider: 'route', id: 'model', name: 'Model',
          inputModalities: ['text', 'image'],
        })
      }
    }(SCRIPT)
    ctx.llm.registerAdapter(['route'], adapter)

    // Model selectors use this exact field; a
    // rebuild that drops it silently reads as "modalities unknown".
    await expect(inspectModel(ctx.llm, 'route', 'model')).resolves.toEqual({
      provider: 'route', id: 'model', name: 'Model',
      inputModalities: ['text', 'image'],
    })
  })

  it('resolves detached model context independently of advisory catalog membership', async () => {
    const ctx = await runtimeContext()
    const source = { contextWindow: 32_000 }
    ctx.llm.registerAdapter(['route'], new CatalogAdapter(
      { id: 'route', name: 'Route' },
      [],
      { unlisted: source },
    ))

    const resolved = await inspectModel(ctx.llm, 'route', 'unlisted')
    expect(resolved.context).toEqual({ contextWindow: 32_000 })
    source.contextWindow = 64_000
    expect(resolved.context).toEqual({ contextWindow: 32_000 })
    await expect(inspectModel(ctx.llm, 'route', 'other')).resolves.toEqual({
      provider: 'route', id: 'other', name: 'other',
    })
  })

  it('resolves detached adapter-owned reasoning metadata and materializes its default', async () => {
    const ctx = await runtimeContext()
    const source = {
      efforts: [
        { id: ReasoningEffortId('standard'), name: 'Standard' },
        { id: ReasoningEffortId('ultra'), name: 'Ultra', description: 'Largest budget' },
      ],
      defaultEffort: ReasoningEffortId('standard'),
    }
    ctx.llm.registerAdapter(['route'], new CatalogAdapter(
      { id: 'route', name: 'Route' },
      [],
      {},
      {
        model: source,
        providerDefault: {
          efforts: [{ id: ReasoningEffortId('standard'), name: 'Standard' }],
        },
      },
    ))

    const resolved = await inspectModel(ctx.llm, 'route', 'model')
    expect(resolved.reasoning).toEqual(source)
    source.efforts[0]!.name = 'mutated'
    expect(resolved.reasoning?.efforts[0]?.name).toBe('Standard')
    await expect(ctx.llm.prepareCall({ provider: 'route', model: 'model' }).then(prepared => prepared.config)).resolves.toEqual({
      provider: 'route',
      model: 'model',
      reasoningEffort: ReasoningEffortId('standard'),
    })
    const explicit = { provider: 'route', model: 'model', reasoningEffort: ReasoningEffortId('ultra') }
    await expect(ctx.llm.prepareCall(explicit).then(prepared => prepared.config)).resolves.toEqual(explicit)
    const providerDefault = { provider: 'route', model: 'providerDefault' }
    await expect(ctx.llm.prepareCall(providerDefault).then(prepared => prepared.config)).resolves.toEqual(providerDefault)
  })

  it('materializes an adapter-owned maxTokens default while preserving an explicit cap', async () => {
    const ctx = await runtimeContext()
    ctx.llm.registerAdapter(['route'], new CatalogAdapter(
      { id: 'route', name: 'Route' },
      [],
      {},
      {},
      { model: 256_000 },
    ))

    await expect(inspectModel(ctx.llm, 'route', 'model')).resolves.toMatchObject({
      defaultMaxTokens: 256_000,
    })
    const preparedDefault = await ctx.llm.prepareCall({ provider: 'route', model: 'model' })
    expect(preparedDefault.config).toEqual({
      provider: 'route',
      model: 'model',
      maxTokens: 256_000,
    })
    expect(preparedDefault.adapterDefaults).toEqual({ maxTokens: true })
    const explicit: LlmCallConfig = { provider: 'route', model: 'model', maxTokens: 8_192 }
    const preparedExplicit = await ctx.llm.prepareCall(explicit)
    expect(preparedExplicit.config).toEqual(explicit)
    expect(preparedExplicit.adapterDefaults).toEqual({})
  })

  it.each([0, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid adapter-owned default maxTokens %s',
    async (defaultMaxTokens) => {
      const ctx = new Context()
      await ctx.plugin(LlmRuntime)
      const adapter = new class extends ScriptedAdapter {
        override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
          return Promise.resolve({ provider, id: model, name: model, defaultMaxTokens })
        }
      }(SCRIPT)
      ctx.llm.registerAdapter(['route'], adapter)

      await expect(inspectModel(ctx.llm, 'route', 'model'))
        .rejects.toMatchObject({ code: 'INVALID_MODEL_MAX_TOKENS' })
    },
  )

  it.each([
    [{ efforts: [] }, 'empty effort list'],
    [{ efforts: [{ id: '', name: 'Empty' }] }, 'empty id'],
    [{ efforts: [{ id: 'valid', name: '' }] }, 'empty name'],
    [{ efforts: [{ id: 'valid', name: 'Valid', description: 1 }] }, 'non-string description'],
    [{ efforts: [{ id: 'same', name: 'One' }, { id: 'same', name: 'Two' }] }, 'duplicate id'],
    [{ efforts: [{ id: 'valid', name: 'Valid' }], defaultEffort: 'other' }, 'unknown default'],
  ] as const)('rejects invalid model reasoning metadata (%s: %s)', async (metadata, _label) => {
    const ctx = await runtimeContext()
    ctx.llm.registerAdapter(['route'], new CatalogAdapter(
      { id: 'route', name: 'Route' },
      [],
      {},
      { model: metadata as unknown as LlmModelReasoningInfo },
    ))
    await expect(inspectModel(ctx.llm, 'route', 'model'))
      .rejects.toMatchObject({ code: 'INVALID_MODEL_REASONING' })
  })

  it('rejects unsupported reasoning efforts without clamping', async () => {
    const ctx = await runtimeContext()
    ctx.llm.registerAdapter(['route'], new CatalogAdapter(
      { id: 'route', name: 'Route' },
      [],
      {},
      { model: { efforts: [{ id: ReasoningEffortId('ultra'), name: 'Ultra' }] } },
    ))

    await expect(ctx.llm.prepareCall({
      provider: 'route',
      model: 'model',
      reasoningEffort: ReasoningEffortId('standard'),
    }).then(prepared => prepared.config)).rejects.toMatchObject({ code: 'UNSUPPORTED_REASONING_EFFORT' })
    await expect(ctx.llm.prepareCall({
      provider: 'route',
      model: 'plain',
      reasoningEffort: ReasoningEffortId('standard'),
    }).then(prepared => prepared.config)).rejects.toMatchObject({ code: 'UNSUPPORTED_REASONING_EFFORT' })
  })

  it('resolves reasoning defaults at the final adapter boundary after routing middleware', async () => {
    const ctx = await runtimeContext()
    const adapter = new class extends RecordingAdapter {
      override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
        const reasoning: LlmModelReasoningInfo = {
          efforts: [{ id: ReasoningEffortId('standard'), name: 'Standard' }],
          defaultEffort: ReasoningEffortId('standard'),
        }
        return Promise.resolve({
          provider,
          id: model,
          name: model,
          reasoning,
        })
      }
    }(SCRIPT)
    ctx.llm.registerAdapter(['routed'], adapter)
    const disposeRouting = ctx.on('llm/stream', (options, next) => {
      options.provider = 'routed'
      return next()
    })

    for await (const _chunk of ctx.llm.stream({
      provider: 'initial',
      model: 'model',
      messages: [],
    })) { /* drain */ }

    expect(adapter.lastOptions?.reasoningEffort).toBe(ReasoningEffortId('standard'))
    disposeRouting()

    const frozenRequest: GenerateOptions = Object.freeze({
      provider: 'routed',
      model: 'model',
      messages: [],
    })
    for await (const _chunk of ctx.llm.stream(frozenRequest)) { /* drain */ }
    expect(adapter.lastOptions?.reasoningEffort).toBe(ReasoningEffortId('standard'))
    expect(Object.isFrozen(adapter.lastOptions)).toBe(true)
  })

  it('pins one adapter registration across asynchronous exact-model resolution and dispatch', async () => {
    const ctx = await runtimeContext()
    const started = Promise.withResolvers<undefined>()
    const reasoning = Promise.withResolvers<LlmModelReasoningInfo>()
    const first = new class extends RecordingAdapter {
      override async resolveModel(
        provider: string,
        model: string,
        _signal?: AbortSignal,
      ): Promise<LlmResolvedModelInfo> {
        started.resolve(undefined)
        return {
          provider,
          id: model,
          name: model,
          reasoning: await reasoning.promise,
        }
      }
    }(SCRIPT)
    const disposeFirst = ctx.llm.registerAdapter(['route'], first)
    const draining = (async () => {
      for await (const _chunk of ctx.llm.stream({
        provider: 'route',
        model: 'model',
        messages: [],
      })) { /* drain */ }
    })()

    await started.promise
    disposeFirst()
    const second = new RecordingAdapter(SCRIPT)
    ctx.llm.registerAdapter(['route'], second)
    reasoning.resolve({
      efforts: [{ id: ReasoningEffortId('high'), name: 'High' }],
      defaultEffort: ReasoningEffortId('high'),
    })
    await draining

    expect(first.lastOptions?.reasoningEffort).toBe(ReasoningEffortId('high'))
    expect(second.lastOptions).toBeUndefined()
  })

  it('prepares a one-shot registration-bound call and rejects config drift', async () => {
    const ctx = await runtimeContext()
    const adapter = new CatalogAdapter(
      { id: 'route', name: 'Route' },
      [],
      {},
      {
        model: {
          efforts: [{ id: ReasoningEffortId('high'), name: 'High' }],
          defaultEffort: ReasoningEffortId('high'),
        },
      },
    )
    ctx.llm.registerAdapter(['route'], adapter)
    const prepared = await ctx.llm.prepareCall({ provider: 'route', model: 'model' })
    expect(Object.isFrozen(prepared.config)).toBe(true)
    expect(Object.isFrozen(prepared.adapterDefaults)).toBe(true)
    expect(prepared.adapterDefaults).toEqual({ reasoningEffort: true })
    expect(() => prepared.stream({
      ...prepared.config,
      model: 'other',
      messages: [],
    })).toThrow(expect.objectContaining({ code: 'INVALID_PREPARED_CALL' }))
    await collect(prepared.stream({
      ...prepared.config,
      messages: [],
    }))
    expect(() => prepared.stream({
      ...prepared.config,
      messages: [],
    })).toThrow(expect.objectContaining({ code: 'INVALID_PREPARED_CALL' }))

    const late = await ctx.llm.prepareCall({ provider: 'route', model: 'model' })
    const lateOptions = { ...late.config, messages: [] }
    const lateStream = late.stream(lateOptions)
    lateOptions.model = 'other'
    expect(await collect(lateStream)).toContainEqual({
      type: 'finish',
      reason: {
        kind: 'error',
        failure: {
          message: 'prepared LLM call config changed before adapter dispatch',
          code: 'INVALID_PREPARED_CALL',
        },
      },
    })
  })

  it.each([
    [undefined, 'high', { reasoningEffort: true }],
    [ReasoningEffortId('minimum'), 'minimum', {}],
  ])('preserves concrete reasoning selection %s during preparation', async (selection, expected, defaults) => {
    const ctx = await runtimeContext()
    const adapter = new class extends RecordingAdapter {
      override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
        return Promise.resolve({
          provider, id: model, name: model,
          reasoning: {
            efforts: ['low', 'minimum', 'high'].map(id => ({ id: ReasoningEffortId(id), name: id })),
            defaultEffort: ReasoningEffortId('high'),
          },
        })
      }
    }(SCRIPT)
    ctx.llm.registerAdapter(['route'], adapter)
    const prepared = await ctx.llm.prepareCall({
      provider: 'route', model: 'model',
      ...selection === undefined ? {} : { reasoningEffort: selection },
    })
    expect(prepared.config.reasoningEffort).toBe(expected)
    expect(prepared.adapterDefaults).toEqual(defaults)
    await collect(prepared.stream({ ...prepared.config, messages: [] }))
    expect(adapter.lastOptions?.reasoningEffort).toBe(expected)
  })

  it('composes controls once before defaults while retaining the captured route', async () => {
    const ctx = await runtimeContext()
    const metadata: LlmResolvedModelInfo = {
      provider: 'route', id: 'model', name: 'Model', defaultMaxTokens: 8_192,
      reasoning: {
        efforts: ['low', 'high'].map(id => ({ id: ReasoningEffortId(id), name: id })),
        defaultEffort: ReasoningEffortId('high'),
      },
    }
    const adapter = new class extends RecordingAdapter {
      override resolveModel(): Promise<LlmResolvedModelInfo> { return Promise.resolve(metadata) }
    }(SCRIPT)
    ctx.llm.registerAdapter(['route'], adapter)
    const selectLeast: ConfigureCall = (controls, model) => ({
      ...controls, reasoningEffort: model.reasoning!.efforts[0]!.id, maxTokens: 256,
    })
    const selectOutput: ConfigureCall = controls => ({ ...controls, maxTokens: 128 })
    const stop = ['END']
    let calls = 0
    const prepared = await ctx.llm.prepareCall({
      provider: 'route', model: 'model', temperature: 0.2, stop,
    }, undefined, (controls, model) => {
      calls++
      expect(controls).toEqual({ temperature: 0.2, stop: ['END'] })
      expect(Object.isFrozen(controls)).toBe(true)
      expect(Object.isFrozen(controls.stop)).toBe(true)
      expect(Object.isFrozen(model)).toBe(true)
      expect(Object.isFrozen(model.reasoning?.efforts)).toBe(true)
      const configured = selectOutput(selectLeast(controls, model), model)
      const wider: LlmCallConfig = { ...configured, provider: 'other', model: 'other' }
      return wider
    })
    expect(calls).toBe(1)
    expect(Object.isFrozen(stop)).toBe(false)
    expect(Object.isFrozen(metadata.reasoning?.efforts)).toBe(false)
    stop.push('LATER')
    expect(prepared.config).toEqual({
      provider: 'route', model: 'model', reasoningEffort: 'low', maxTokens: 128,
      temperature: 0.2, stop: ['END'],
    })
    expect(prepared.adapterDefaults).toEqual({})
    await collect(prepared.stream({ ...prepared.config, messages: [] }))
    expect(adapter.lastOptions).toEqual({ ...prepared.config, messages: [] })
    expect(calls).toBe(1)
  })

  it('applies defaults to controls omitted by the configuration function', async () => {
    const ctx = await runtimeContext()
    ctx.llm.registerAdapter(['route'], new CatalogAdapter(
      { id: 'route', name: 'Route' }, [], {},
      { model: { efforts: [{ id: ReasoningEffortId('high'), name: 'High' }], defaultEffort: ReasoningEffortId('high') } },
      { model: 8_192 },
    ))
    const prepared = await ctx.llm.prepareCall({
      provider: 'route', model: 'model', reasoningEffort: ReasoningEffortId('unsupported'), maxTokens: 64,
    }, undefined, () => ({}))
    expect(prepared.config).toEqual({ provider: 'route', model: 'model', reasoningEffort: 'high', maxTokens: 8_192 })
    expect(prepared.adapterDefaults).toEqual({ reasoningEffort: true, maxTokens: true })
    const explicit = await ctx.llm.prepareCall({ provider: 'route', model: 'model' }, undefined, () => ({
      reasoningEffort: ReasoningEffortId('high'), maxTokens: 8_192,
    }))
    expect(explicit.adapterDefaults).toEqual({})
  })

  it('rejects callback failures and unsupported configured effort before dispatch', async () => {
    const ctx = await runtimeContext()
    const adapter = new RecordingAdapter(SCRIPT)
    ctx.llm.registerAdapter(['route'], adapter)
    const failure = new Error('configuration unavailable')
    await expect(ctx.llm.prepareCall({ provider: 'route', model: 'model' }, undefined, () => {
      throw failure
    })).rejects.toBe(failure)
    await expect(ctx.llm.prepareCall({ provider: 'route', model: 'model' }, undefined, () => ({
      reasoningEffort: ReasoningEffortId('unsupported'),
    }))).rejects.toMatchObject({ code: 'UNSUPPORTED_REASONING_EFFORT' })
    expect(adapter.lastOptions).toBeUndefined()
  })

  it('skips configuration when cancellation precedes preparation or occurs during model lookup', async () => {
    const ctx = await runtimeContext()
    const abort = new AbortController()
    const failure = new Error('cancelled preparation')
    let lookups = 0
    let configurations = 0
    const adapter = new class extends RecordingAdapter {
      override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
        lookups++
        abort.abort(failure)
        return Promise.resolve({ provider, id: model, name: model })
      }
    }(SCRIPT)
    ctx.llm.registerAdapter(['route'], adapter)
    const configure: ConfigureCall = (controls) => { configurations++; return controls }
    await expect(ctx.llm.prepareCall({ provider: 'route', model: 'model' }, abort.signal, configure)).rejects.toBe(failure)
    await expect(ctx.llm.prepareCall({ provider: 'route', model: 'model' }, abort.signal, configure)).rejects.toBe(failure)
    expect(lookups).toBe(1)
    expect(configurations).toBe(0)
    expect(adapter.lastOptions).toBeUndefined()
  })

  it('rejects cancellation raised during configuration before returning a prepared call', async () => {
    const ctx = await runtimeContext()
    const adapter = new RecordingAdapter(SCRIPT)
    ctx.llm.registerAdapter(['route'], adapter)
    const abort = new AbortController()
    const failure = new Error('cancelled configuration')
    await expect(ctx.llm.prepareCall({ provider: 'route', model: 'model' }, abort.signal, (controls) => {
      abort.abort(failure)
      return controls
    })).rejects.toBe(failure)
    expect(adapter.lastOptions).toBeUndefined()
  })

  it('reuses one exact-model lookup for prepared config and context metadata', async () => {
    const ctx = await runtimeContext()
    let resolutions = 0
    const source = { contextWindow: 128_000 }
    const adapter = new class extends ScriptedAdapter {
      override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
        resolutions += 1
        return Promise.resolve({
          provider,
          id: model,
          name: model,
          description: 'Resolved model',
          context: source,
          reasoning: model === 'no-default'
            ? { efforts: [{ id: ReasoningEffortId('high'), name: 'High' }] }
            : {
              efforts: [{ id: ReasoningEffortId('high'), name: 'High' }],
              defaultEffort: ReasoningEffortId('high'),
            },
        })
      }
    }(SCRIPT)
    ctx.llm.registerAdapter(['route'], adapter)

    const prepared = await ctx.llm.prepareCall({ provider: 'route', model: 'model' })
    source.contextWindow = 64_000
    expect(prepared.config.reasoningEffort).toBe(ReasoningEffortId('high'))
    expect(prepared.context).toEqual({ contextWindow: 128_000 })
    expect(Object.isFrozen(prepared.context)).toBe(true)
    for await (const _chunk of prepared.stream({
      ...prepared.config,
      messages: [],
    })) { /* drain */ }
    expect(resolutions).toBe(1)

    const noDefault = await ctx.llm.prepareCall({ provider: 'route', model: 'no-default' })
    expect(noDefault.config).toEqual({ provider: 'route', model: 'no-default' })
    expect(noDefault.context).toEqual({ contextWindow: 64_000 })
    expect(resolutions).toBe(2)
  })

  it('binds adapter-owned capabilities and dispatch to one prepared generation', async () => {
    const ctx = await runtimeContext()
    let generation = 'first'
    let dispatched: string | undefined
    const adapter = new class extends ScriptedAdapter {
      override prepareCall(provider: string, model: string) {
        const captured = generation
        return Promise.resolve({
          model: {
            provider, id: model, name: model, inputModalities: ['text'] as const,
            reasoning: {
              efforts: [{ id: ReasoningEffortId(captured), name: captured }],
            },
          },
          stream: (options: GenerateOptions) => {
            dispatched = captured
            return super.stream(options)
          },
        })
      }
    }(SCRIPT)
    ctx.llm.registerAdapter(['route'], adapter)

    const prepared = await ctx.llm.prepareCall({
      provider: 'route', model: 'model',
    }, undefined, (controls, model) => ({ ...controls, reasoningEffort: model.reasoning!.efforts[0]!.id }))
    generation = 'second'
    expect(prepared.config.reasoningEffort).toBe('first')
    expect(prepared.inputModalities).toEqual(['text'])
    expect(Object.isFrozen(prepared.inputModalities)).toBe(true)
    await collect(prepared.stream({ ...prepared.config, messages: [] }))
    expect(dispatched).toBe('first')
  })

  it('passes cancellation through exact-model resolution', async () => {
    const ctx = await runtimeContext()
    const started = Promise.withResolvers<undefined>()
    const adapter = new class extends ScriptedAdapter {
      override resolveModel(
        _provider: string,
        _model: string,
        signal?: AbortSignal,
      ): Promise<LlmResolvedModelInfo> {
        started.resolve(undefined)
        return new Promise<LlmResolvedModelInfo>((_resolve, reject) => {
          if (signal === undefined) {
            reject(new Error('missing reasoning signal'))
            return
          }
          if (signal.aborted) {
            reject(signal.reason instanceof Error ? signal.reason : new Error('reasoning aborted'))
            return
          }
          signal.addEventListener('abort', () => {
            reject(signal.reason instanceof Error ? signal.reason : new Error('reasoning aborted'))
          }, { once: true })
        })
      }
    }(SCRIPT)
    ctx.llm.registerAdapter(['route'], adapter)
    const controller = new AbortController()
    const resolving = ctx.llm.prepareCall({ provider: 'route', model: 'model' }, controller.signal).then(prepared => prepared.config)

    await started.promise
    const reason = new Error('cancel reasoning')
    controller.abort(reason)
    await expect(resolving).rejects.toBe(reason)
  })

  it.each([0, -1, 1.5, Number.NaN])(
    'rejects invalid adapter model context %s',
    async (contextWindow) => {
      const ctx = new Context()
      await ctx.plugin(LlmRuntime)
      ctx.llm.registerAdapter(['route'], new CatalogAdapter(
        { id: 'route', name: 'Route' },
        [],
        { model: { contextWindow } },
      ))
      await expect(inspectModel(ctx.llm, 'route', 'model'))
        .rejects.toMatchObject({ code: 'INVALID_MODEL_CONTEXT' })
    },
  )

  it.each([
    [{ id: 1, name: 'Name' }, 'non-string id'],
    [{ id: 'other', name: 'Name' }, 'mismatched id'],
    [{ id: 'route', name: 1 }, 'non-string name'],
    [{ id: 'route', name: '' }, 'empty name'],
  ] as const)('rejects invalid provider metadata atomically (%s: %s)', async (metadata, _label) => {
    const ctx = await runtimeContext()
    const adapter = new CatalogAdapter(metadata as unknown as LlmProviderInfo, [])
    expect(() => ctx.llm.registerAdapter(['route'], adapter)).toThrow(expect.objectContaining({ code: 'INVALID_ADAPTER' }))
    expect(ctx.llm.listProviders()).toEqual([])
  })

  it.each([
    [{ provider: 1, id: 'm', name: 'M' }, 'non-string provider'],
    [{ provider: 'other', id: 'm', name: 'M' }, 'mismatched provider'],
    [{ provider: 'route', id: 1, name: 'M' }, 'non-string id'],
    [{ provider: 'route', id: '', name: 'M' }, 'empty id'],
    [{ provider: 'route', id: 'm', name: 1 }, 'non-string name'],
    [{ provider: 'route', id: 'm', name: '' }, 'empty name'],
    [{ provider: 'route', id: 'm', name: 'M', description: 1 }, 'non-string description'],
  ] as const)('rejects invalid model metadata (%s: %s)', async (metadata, _label) => {
    const ctx = await runtimeContext()
    ctx.llm.registerAdapter(['route'], new CatalogAdapter(
      { id: 'route', name: 'Route' },
      [metadata as unknown as LlmModelInfo],
    ))
    await expect(ctx.llm.listModels('route')).rejects.toMatchObject({ code: 'INVALID_CATALOG' })
  })

  it('rejects duplicate model ids in one provider catalog', async () => {
    const ctx = await runtimeContext()
    const model = { provider: 'route', id: 'same', name: 'Same' }
    ctx.llm.registerAdapter(['route'], new CatalogAdapter({ id: 'route', name: 'Route' }, [model, model]))
    await expect(ctx.llm.listModels('route')).rejects.toMatchObject({ code: 'INVALID_CATALOG' })
  })

  it('lets llm/stream waterfall listeners wrap the underlying stream', async () => {
    const ctx = await runtimeContext()
    ctx.llm.registerAdapter(['test-model'], new ScriptedAdapter(SCRIPT))

    ctx.on('llm/stream', function (_options, next) {
      const inner = next()
      return (async function * () {
        yield { type: 'block-start', index: 99, blockType: 'text' } satisfies StreamChunk
        yield { type: 'block-end', index: 99, block: { type: 'text', text: '' } } satisfies StreamChunk
        yield * inner
      })()
    })

    const chunks: StreamChunk[] = []
    for await (const chunk of ctx.llm.stream({ provider: 'test-model', model: 'dynamic-model', messages: [] })) chunks.push(chunk)
    expect(chunks).toHaveLength(6)
    expect(chunks[0]).toMatchObject({ index: 99 })
  })

  it('resolves the provider after llm/stream listeners have had a chance to route it', async () => {
    const ctx = await runtimeContext()
    const adapter = new RecordingAdapter(SCRIPT)
    ctx.llm.registerAdapter(['routed'], adapter)
    ctx.on('llm/stream', (options, next) => {
      options.provider = 'routed'
      return next()
    })

    for await (const _chunk of ctx.llm.stream({ provider: 'initial', model: 'm', messages: [] })) { /* drain */ }
    expect(adapter.lastOptions?.provider).toBe('routed')
  })

  it('creates LlmError with a code for programmatic handling', () => {
    const err = new LlmError('something went wrong', 'CUSTOM_CODE')
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('LlmError')
    expect(err.message).toBe('something went wrong')
    expect(err.code).toBe('CUSTOM_CODE')
  })

  it('rejects non-serializable structured failure facts at construction', () => {
    expect(() => new LlmError('busy', 'RATE_LIMIT', { status: 42 })).toThrow(/status/)
    expect(() => new LlmError('busy', 'RATE_LIMIT', { providerRetryAfterMs: Number.NaN }))
      .toThrow(/providerRetryAfterMs/)
    expect(() => new LlmError('busy', 'RATE_LIMIT', { requestId: ProviderRequestId('') })).toThrow(/requestId/)
    expect(() => new LlmError(1 as never, 'RATE_LIMIT')).toThrow(/message/)
    expect(() => new LlmError('busy', 1 as never)).toThrow(/code/)
    expect(() => new LlmError('busy', 'RATE_LIMIT', { requestId: 1 as never })).toThrow(/requestId/)
  })

  it('LlmError extends the shared HarnessError base', async () => {
    const cause = new Error('root cause')
    const err = new LlmError('boom', 'AUTH', { cause })
    expect(err).toBeInstanceOf(HarnessError)
    expect(err.code).toBe('AUTH')
    expect(err.cause).toBe(cause)
  })

  it('HarnessError carries a code, names itself by subclass, and chains cause', async () => {
    const root = new Error('root cause')
    const err = new HarnessError('wrapper', 'UNKNOWN', { cause: root })
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('HarnessError')
    expect(err.code).toBe('UNKNOWN')
    expect(err.cause).toBe(root)
  })

  it('rejects duplicate adapter registration with DUPLICATE_ADAPTER code', async () => {
    const ctx = await runtimeContext()
    ctx.llm.registerAdapter(['m1'], new ScriptedAdapter(SCRIPT))
    try {
      ctx.llm.registerAdapter(['m1'], new ScriptedAdapter(SCRIPT))
      expect.fail('expected error')
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(LlmError)
      expect((error as LlmError).message).toContain('already registered')
      expect((error as LlmError).code).toBe('DUPLICATE_ADAPTER')
    }
  })

  it('rejects empty and internally duplicated provider registrations atomically', async () => {
    const ctx = await runtimeContext()
    const adapter = new ScriptedAdapter(SCRIPT)

    expect(() => ctx.llm.registerAdapter([], adapter)).toThrow(expect.objectContaining({ code: 'INVALID_ADAPTER' }))
    expect(() => ctx.llm.registerAdapter([''], adapter)).toThrow(expect.objectContaining({ code: 'INVALID_ADAPTER' }))
    expect(() => ctx.llm.registerAdapter(['first', 'first'], adapter)).toThrow(expect.objectContaining({ code: 'DUPLICATE_ADAPTER' }))
    expect(ctx.llm.listProviders()).toEqual([])
  })

  it('re-registers a model after its prior registration is disposed', async () => {
    const ctx = await runtimeContext()

    const dispose = ctx.llm.registerAdapter(['m1'], new ScriptedAdapter(SCRIPT))
    expect(ctx.llm.listProviders()).toEqual([{ id: 'm1', name: 'm1' }])
    dispose()
    expect(ctx.llm.listProviders()).toEqual([])

    // The duplicate check is not wedged: the same model registers cleanly again.
    const disposeAgain = ctx.llm.registerAdapter(['m1'], new ScriptedAdapter(SCRIPT))
    expect(ctx.llm.listProviders()).toEqual([{ id: 'm1', name: 'm1' }])
    disposeAgain()
    expect(ctx.llm.listProviders()).toEqual([])
  })

  it('refuses to replace routes on a registration that was already released', async () => {
    // The leak this prevents: the effect's disposer has run, so a route added
    // afterwards would sit in the registry with nothing left to release it.
    const ctx = await runtimeContext()

    const handle = ctx.llm.registerAdapter(['m1'], new ScriptedAdapter(SCRIPT))
    handle()
    expect(() => { handle.replace(['leaked']) })
      .toThrow(/disposed adapter registration cannot replace its routes/)
    expect(ctx.llm.listProviders()).toEqual([])
  })

  it('still allows an empty route set on a live registration', async () => {
    // `replace([])` is the settings-section-emptied case: legal, and it must
    // not be mistaken for disposal by the guard above.
    const ctx = await runtimeContext()

    const handle = ctx.llm.registerAdapter(['m1'], new ScriptedAdapter(SCRIPT))
    handle.replace([])
    expect(ctx.llm.listProviders()).toEqual([])
    handle.replace(['m2'])
    expect(ctx.llm.listProviders()).toEqual([{ id: 'm2', name: 'm2' }])
    handle()
    expect(ctx.llm.listProviders()).toEqual([])
  })
})
