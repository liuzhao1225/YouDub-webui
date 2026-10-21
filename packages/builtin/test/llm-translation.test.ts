import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type ServerResponse } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Invocation, InvocationContext, JsonObject } from '@youdub/sdk'
import { translateWithModel, validateWireTokenLimit } from '../src/llm-translation.js'

const answer = JSON.stringify({ segments: [{ segment_id: 'segment-b', text: '第二段' }, { segment_id: 'segment-a', text: '你好' }] })
function respond(res: ServerResponse, api: string, content = answer) {
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  const send = (value: JsonObject) => res.write(`${value.type ? `event: ${value.type}\n` : ''}data: ${JSON.stringify(value)}\n\n`)
  if (api === 'openai-completions') {
    send({ id: 'chat-local', object: 'chat.completion.chunk', model: 'text-model', choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: null }] })
    send({ id: 'chat-local', object: 'chat.completion.chunk', model: 'text-model', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })
    res.write('data: [DONE]\n\n')
  } else if (api === 'openai-responses') {
    send({ type: 'response.created', response: { id: 'resp-local', status: 'in_progress' } })
    send({ type: 'response.output_item.added', output_index: 0, item: { id: 'msg-local', type: 'message', role: 'assistant', content: [] } })
    send({ type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: content })
    send({ type: 'response.completed', response: { id: 'resp-local', status: 'completed', output: [], usage: { input_tokens: 20, output_tokens: 10 } } })
  } else {
    send({ type: 'message_start', message: { id: 'msg-local', type: 'message', role: 'assistant', model: 'text-model', content: [], stop_reason: null, usage: { input_tokens: 20, output_tokens: 0 } } })
    send({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
    send({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: content } })
    send({ type: 'content_block_stop', index: 0 })
    send({ type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 10 } })
    send({ type: 'message_stop' })
  }
  res.end()
}
async function fixture(t: TestContext, api = 'openai-completions', content = answer, status = 200) {
  const workDir = await mkdtemp(join(tmpdir(), 'youdub-llm-'))
  const received: { url: string; body: JsonObject; authorization?: string; key?: string }[] = []
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(chunk)
    received.push({ url: req.url!, body: JSON.parse(Buffer.concat(chunks).toString()), authorization: req.headers.authorization, key: req.headers['x-api-key'] as string })
    if (status !== 200) { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { type: 'invalid_request_error', message: 'Requested output limit rejected' } })); return }
    respond(res, api, content)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); await rm(workDir, { recursive: true }) })
  const baseURL = `http://127.0.0.1:${(server.address() as { port: number }).port}${api === 'anthropic-messages' ? '' : '/v1'}`
  const request: Invocation = { invocationId: 'invoke-local', taskId: 'task-local', attempt: 1, stepId: 'translate', operation: 'translate', binding: { providerId: 'llm.local', pluginId: 'youdub.llm', pluginVersion: '1', integrity: 'test', modelRevision: null, model: 'text-model', options: { targetLanguage: 'zh', maxCompletionTokens: 65535 } }, inputs: { transcript: { detected_language: 'en', segments: [{ id: 'segment-a', start_ms: 0, end_ms: 1000, text: 'Hello' }, { id: 'segment-b', start_ms: 1000, end_ms: 2000, text: 'Second segment' }] } }, workDir, taskDir: workDir, config: {} }
  const prepared: JsonObject[] = [], updated: JsonObject[] = [], controller = new AbortController()
  const context: InvocationContext = { signal: controller.signal, progress: async () => {}, externalPrepare: async value => { prepared.push(value) }, externalUpdate: async value => { updated.push(value) }, register: async () => { throw new Error('No artifact expected') }, resolve: async () => { throw new Error('No artifact expected') }, credentials: { 'llm.local': { base_url: baseURL, api_key: 'local-fixture-key', profile: { api, baseURL, models: [{ id: 'text-model', contextWindow: 131072, maxTokens: 70000 }] } } } }
  return { request, context, received, prepared, updated, controller }
}
for (const [api, path, token] of [['openai-completions', '/v1/chat/completions', 'max_completion_tokens'], ['openai-responses', '/v1/responses', 'max_output_tokens'], ['anthropic-messages', '/v1/messages', 'max_tokens']]) {
  test(`${api} executes through pi-ai with the required wire cap and preserves source IDs`, async t => {
    const { request, context, received, prepared, updated } = await fixture(t, api)
    const result = await translateWithModel('local', request, context)
    assert.equal(result.state, 'completed')
    if (result.state !== 'completed') throw new Error('Expected synchronous completion')
    assert.deepEqual(result.outputs.translation.segments, [{ segment_id: 'segment-a', text: '你好' }, { segment_id: 'segment-b', text: '第二段' }])
    assert.equal(received.length, 1)
    assert.equal(received[0].url, path)
    assert.equal(received[0].body[token], 65535)
    assert.equal(api === 'anthropic-messages' ? received[0].key : received[0].authorization, api === 'anthropic-messages' ? 'local-fixture-key' : 'Bearer local-fixture-key')
    assert.equal(prepared.length, 1); assert.equal(updated[0].state, 'succeeded')
    const evidence = JSON.parse(await readFile(join(request.workDir, 'translation_raw/0001.request.json'), 'utf8'))
    assert.equal(evidence[token], 65535)
    assert.equal(JSON.parse(await readFile(join(request.workDir, 'translation_raw/0001.response.json'), 'utf8')).stopReason, 'stop')
  })
}
test('insufficient catalog capacity and an SDK-clamped wire cap stop before submission', async t => {
  const { request, context, received, prepared } = await fixture(t)
  context.credentials['llm.local'].profile!.models[0].maxTokens = 4096
  await assert.rejects(translateWithModel('local', request, context), { code: 'OUTPUT_LIMIT_UNSUPPORTED' })
  assert.equal(received.length, 0); assert.equal(prepared.length, 0)
  for (const [api, payload] of Object.entries({ 'openai-completions': { max_tokens: 4096 }, 'openai-responses': { max_output_tokens: 4096 }, 'anthropic-messages': { max_tokens: 4096 }, 'google-generative-ai': { config: { maxOutputTokens: 4096 } }, 'bedrock-converse-stream': { inferenceConfig: { maxTokens: 4096 } }, 'mistral-conversations': { maxTokens: 4096 }, 'pi-messages': { options: { maxTokens: 4096 } } })) assert.throws(() => validateWireTokenLimit(payload, api), { code: 'OUTPUT_LIMIT_UNSUPPORTED' })
})
test('an endpoint refusal is visible and is never retried with a lower limit', async t => {
  const { request, context, received, prepared, updated } = await fixture(t, 'openai-completions', answer, 400)
  await assert.rejects(translateWithModel('local', request, context), /Requested output limit rejected/)
  assert.equal(received.length, 1); assert.equal(received[0].body.max_completion_tokens, 65535)
  assert.equal(prepared.length, 1)
  // pi-ai exposes HTTP metadata on successful responses only; a refusal remains
  // pending for the task runtime's external-outcome reconciliation.
  assert.equal(updated.length, 0)
})
test('malformed output remains a visible failure with response evidence', async t => {
  const { request, context } = await fixture(t, 'openai-completions', 'null')
  await assert.rejects(translateWithModel('local', request, context), { code: 'INVALID_PROVIDER_RESULT' })
  assert.equal(JSON.parse(await readFile(join(request.workDir, 'translation_raw/0001.response.json'), 'utf8')).content[0].text, 'null')
})
test('cancellation after one completed batch stops all remaining requests', async t => {
  const { request, context, controller, received } = await fixture(t)
  request.inputs.transcript.segments = Array.from({ length: 22 }, (_, index) => ({ id: `segment-${index}`, start_ms: index * 1000, end_ms: (index + 1) * 1000, text: 'Hello' }))
  context.externalUpdate = async () => { controller.abort(new Error('User cancelled')) }
  await assert.rejects(translateWithModel('local', request, context), /User cancelled/)
  assert.equal(received.length, 1)
})
