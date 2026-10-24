import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import LlmRuntime from '@deepseek-ai/dsh-llm';
import * as PiAi from '@deepseek-ai/dsh-llm-pi-ai';
import { translateWithHarness } from '../dist/host.mjs';

// This endpoint is deliberately a local fixture. It verifies the actual official
// adapter's request bytes; it makes no claim about external translation quality.
test('official LLM adapter serializes the required output cap and surfaces provider rejection', { timeout: 30000 }, async t => {
  const calls = []; let reject = false;
  const server = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw); calls.push({ path: req.url, body });
    if (reject) { res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { message: 'fixture rejects max_tokens 65535', type: 'invalid_request_error', code: 'unsupported_limit' } })); return; }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('data: ' + JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture-model', choices: [{ index: 0, delta: { role: 'assistant', content: JSON.stringify({ segments: [{ segment_id: 's1', text: '你好' }] }) }, finish_reason: null }] }) + '\n\n');
    res.write('data: ' + JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture-model', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } }) + '\n\n');
    res.end('data: [DONE]\n\n');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const ctx = new Context(), runtime = ctx.plugin(LlmRuntime); await runtime;
  const profile = { api: 'openai-completions', baseURL: `http://127.0.0.1:${server.address().port}/v1`, apiKeyEnv: 'YOUDUB_TEST_LOCAL_FIXTURE',
    models: [{ id: 'fixture-model', name: 'Fixture', contextWindow: 131072, maxTokens: 65535, input: ['text'] }], compat: { maxTokensField: 'max_tokens' } };
  const catalogProfile = { apiKeyEnv: profile.apiKeyEnv, baseURL: profile.baseURL };
  const providers = { fixture: profile, deepseek: catalogProfile };
  const settings = { describe: () => [{ ns: 'llm-pi-ai', value: { providers } }], configure: () => () => {} };
  const services = ctx.plugin({ name: 'fixture-official-config', apply(child) {
    child.reflect.provide('settings', settings); child.reflect.provide('credentials', { resolve: async ref => ref === 'YOUDUB_TEST_LOCAL_FIXTURE' ? { value: 'test-fixture-only', source: 'process' } : undefined });
  } }); await services;
  const adapter = ctx.plugin(PiAi, { providers }); await adapter;
  const dirs = [];
  const execute = async (options, route = 'fixture', model = 'fixture-model') => {
    const dir = await mkdtemp(join(tmpdir(), 'youdub-llm-fixture-')); dirs.push(dir);
    const receipts = [];
    const result = translateWithHarness(ctx.llm, settings, route, { invocationId: 'fixture-' + dirs.length, workDir: dir, inputs: { transcript: { detected_language: 'en', segments: [{ id: 's1', start_ms: 0, end_ms: 1000, text: 'hello' }] } }, binding: { model, options: { targetLanguage: 'zh', ...options } }, config: {} }, {
      signal: new AbortController().signal, progress: async () => {}, externalPrepare: async receipt => receipts.push(receipt), externalUpdate: async receipt => receipts.push(receipt),
    });
    return { result, dir, receipts };
  };
  try {
    await t.test('request reaches the local endpoint with 65535 tokens and preserves raw canonical evidence', async () => {
      const run = await execute(); const result = await run.result;
      assert.equal(result.outputs.translation.segments[0].text, '你好'); assert.equal(calls.length, 1);
      assert.equal(calls[0].path, '/v1/chat/completions'); assert.equal(calls[0].body.max_tokens, 65535);
      assert.equal(calls[0].body.messages.at(-1).role, 'user');
      assert.match(JSON.stringify(calls[0].body.messages.at(-1).content), /hello/);
      const system = calls[0].body.messages.find(message => message.role === 'system').content;
      assert.equal(createHash('sha256').update(system.slice(system.indexOf('\n\n') + 2)).digest('hex'),
        '40c70237fdf1a4961bc3df9ee6f2d5c30ba361ba17904d2c4bfc0afbef3580f0');
      assert.match(system, /对于长句，使用逗号进行更详细的分句。/);
      assert.match(system, /必须使用标点。/);
      assert.match(system, /Preserve every segment_id exactly once/);
      const evidence = JSON.parse(await readFile(join(run.dir, 'translation_raw/0001.request.json'), 'utf8'));
      assert.equal(evidence.maxTokens, 65535); assert.equal(evidence.messages[0].content[0].type, 'text');
      assert.equal(run.receipts.at(-1).state, 'succeeded');
    });
    await t.test('smaller cap and capacity fail before network dispatch', async () => {
      await assert.rejects((await execute({ maxCompletionTokens: 65534 })).result, { code: 'INVALID_CONFIG' });
      profile.models[0].maxTokens = 32768;
      await assert.rejects((await execute()).result, { code: 'OUTPUT_LIMIT_UNSUPPORTED' });
      profile.models[0].maxTokens = 65535;
      assert.equal(calls.length, 1);
    });
    await t.test('endpoint incompatibility remains a visible failure without a lower-cap retry', async () => {
      reject = true;
      const run = await execute(); await assert.rejects(run.result, /fixture rejects max_tokens 65535/);
      assert.equal(calls.length, 2); assert.equal(calls[1].body.max_tokens, 65535); // The official adapter retains the message but omits HTTP status here.
      // Preserve the pending receipt instead of asserting an unobserved terminal state.
      assert.equal(run.receipts.length, 1); assert.equal(run.receipts[0].state, undefined);
    });
    await t.test('non-Chinese translation omits Chinese punctuation rules and retains segment units', async () => {
      reject = false;
      const run = await execute({ targetLanguage: 'ja' }); const result = await run.result;
      assert.deepEqual(result.outputs.translation.segments.map(segment => segment.segment_id), ['s1']);
      assert.equal(calls.at(-1).body.max_tokens, 65535);
      const system = calls.at(-1).body.messages.find(message => message.role === 'system').content;
      assert.doesNotMatch(system, /对于长句，使用逗号进行更详细的分句。/);
      assert.match(system, /Translate from en to ja/);
    });
    await t.test('built-in catalog defaults reach the endpoint without manual protocol or capacity fields', async () => {
      const [model] = await ctx.llm.listModels('deepseek');
      const run = await execute({}, 'deepseek', model.id);
      assert.equal((await run.result).outputs.translation.segments[0].text, '你好');
      assert.equal(calls.at(-1).body.model, model.id);
      assert.equal(calls.at(-1).body.max_tokens, 65535);
      assert.deepEqual(catalogProfile, { apiKeyEnv: profile.apiKeyEnv, baseURL: profile.baseURL });
    });
  } finally { await adapter.dispose(); await services.dispose(); await runtime.dispose(); await new Promise(resolve => server.close(resolve)); await Promise.all(dirs.map(dir => rm(dir, { recursive: true, force: true }))); }
});
