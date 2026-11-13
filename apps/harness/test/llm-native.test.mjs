import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import LlmRuntime from '@deepseek-ai/dsh-llm';
import * as PiAi from '@deepseek-ai/dsh-llm-pi-ai';
import { register } from 'tsx/esm/api';

const source = register({ namespace: 'llm-native' });
const { translateWithHarness } = await source.import('../src/backend/llm.mjs', import.meta.url);
after(() => source.unregister());

test('sentence translation through the Harness model adapter', { timeout: 30000 }, async t => {
  const calls = [];
  const outputs = new Map([['Hello.', '你好。'], ['Go now.', '现在出发。']]);
  let malformed = 0, reject = false;
  const server = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const path = new URL(req.url, 'http://localhost').pathname;
    const body = JSON.parse(raw); calls.push({ path, body });
    if (reject) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'fixture provider rejected the schema', type: 'invalid_request_error' } }));
      return;
    }
    const anthropic = path.endsWith('/messages');
    const responses = path.endsWith('/responses');
    const messages = body.messages ?? body.input;
    const content = messages.at(-1).content;
    const { en } = JSON.parse(typeof content === 'string' ? content : content[0].text);
    const text = en === 'Go now.' && malformed-- > 0 ? '{"wrong":"ignored"}' : JSON.stringify({ zh: outputs.get(en) });
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    if (anthropic) {
      const events = [
        { type: 'message_start', message: { id: 'msg_fixture', type: 'message', role: 'assistant', model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 10 } },
        { type: 'message_stop' },
      ];
      for (const event of events) res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      res.end();
      return;
    }
    if (responses) {
      const message = { type: 'message', id: 'msg_fixture', role: 'assistant', content: [{ type: 'output_text', text, annotations: [] }], status: 'completed' };
      const response = { id: 'resp_fixture', model: body.model, status: 'completed', output: [message], usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 } };
      const events = [
        { type: 'response.created', response: { ...response, status: 'in_progress', output: [] } },
        { type: 'response.output_item.added', output_index: 0, item: { ...message, status: 'in_progress', content: [] } },
        { type: 'response.content_part.added', item_id: message.id, output_index: 0, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } },
        { type: 'response.output_text.delta', item_id: message.id, output_index: 0, content_index: 0, delta: text },
        { type: 'response.output_item.done', output_index: 0, item: message },
        { type: 'response.completed', response },
      ];
      for (const event of events) res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      res.end();
      return;
    }
    const envelope = { id: 'fixture', object: 'chat.completion.chunk', created: 1, model: body.model };
    for (const choices of [
      [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }],
      [{ index: 0, delta: {}, finish_reason: 'stop' }],
    ]) res.write('data: ' + JSON.stringify({ ...envelope, choices }) + '\n\n');
    res.end('data: [DONE]\n\n');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const baseURL = `http://127.0.0.1:${server.address().port}`;
  const apiKeyEnv = 'YOUDUB_TEST_LOCAL_FIXTURE';
  const models = [{ id: 'fixture-model', contextWindow: 131072, maxTokens: 65535 }];
  const providers = {
    fixture: { api: 'openai-completions', baseURL: baseURL + '/v1', apiKeyEnv, models, compat: { maxTokensField: 'max_tokens' } },
    small: { api: 'openai-completions', baseURL: baseURL + '/v1', apiKeyEnv, models: [{ ...models[0], maxTokens: 2048 }] },
    anthropic: { api: 'anthropic-messages', baseURL, apiKeyEnv, models },
    responses: { api: 'openai-responses', baseURL: baseURL + '/v1', apiKeyEnv, models, compat: { supportsDeveloperRole: false } },
    noCap: { api: 'openai-responses', baseURL: baseURL + '/v1', apiKeyEnv, models, compat: { supportsMaxOutputTokens: false } },
    deepseek: { apiKeyEnv, models: [{ id: 'deepseek-flash' }] },
  };
  const ctx = new Context(), runtime = ctx.plugin(LlmRuntime); await runtime;
  const settings = { describe: () => [{ ns: 'llm-pi-ai', value: { providers } }], configure: () => () => {} };
  const services = ctx.plugin({ name: 'fixture-official-config', apply(child) {
    child.reflect.provide('settings', settings);
    child.reflect.provide('credentials', { resolve: async () => ({ value: 'test-fixture-only', source: 'process' }) });
  } }); await services;
  const adapter = ctx.plugin(PiAi, { providers }); await adapter;
  const taskDir = await mkdtemp(join(tmpdir(), 'youdub-llm-fixture-'));
  let run = 0;
  const execute = async ({ route = 'fixture', root = taskDir, model = 'fixture-model', options = {}, sentences = ['Hello.', 'Go now.'] } = {}) => {
    const invocationId = String(++run), workDir = join(root, invocationId);
    await mkdir(workDir, { recursive: true });
    const log = [], receipts = [];
    const result = translateWithHarness(ctx.llm, route, { invocationId, workDir, taskDir: root, stepId: 'translate',
      inputs: { transcript: { detected_language: 'en', segments: sentences.map((text, i) => ({
        id: `s${i+1}`, start_ms: i*1000, end_ms: (i+1)*1000, text,
      })) } }, binding: { model, integrity: 'test', options: { targetLanguage: 'zh', ...options } }, config: {},
    }, { signal: new AbortController().signal, progress: async () => {}, log: async item => log.push(item),
      externalPrepare: async r => receipts.push(r), externalUpdate: async r => receipts.push(r) });
    return { result, workDir, log, receipts };
  };
  try {
    await t.test('continues from the failed sentence with the full accepted history', async () => {
      malformed = 3;
      const first = await execute({ options: { maxCompletionTokens: 512 } });
      await assert.rejects(first.result, /第 2\/2 句（s2）/);
      assert.equal(calls.length, 4);
      assert.equal(first.log.length, 3);
      assert.equal(first.receipts.filter(r => r.mayStillRun === false).length, 4);
      assert.equal(calls[0].body.max_tokens, 65535);
      assert.equal(calls[0].body.response_format.json_schema.strict, true);
      assert.deepEqual(calls[0].body.response_format.json_schema.schema.required, ['zh']);
      const [system, user] = calls[0].body.messages;
      assert.match(system.content, /\["Hello\.","Go now\."\]/);
      assert.match(system.content, /必须使用标点/);
      assert.deepEqual(user, { role: 'user', content: '{"en":"Hello."}' });
      const expected = [system, user, { role: 'assistant', content: '{"zh":"你好。"}' }, { role: 'user', content: '{"en":"Go now."}' }];
      for (const call of calls.slice(1)) assert.deepEqual(call.body.messages, expected);
      const responsePath = join(first.workDir, 'translation_raw', '000002.1.response.json');
      const original = await readFile(responsePath, 'utf8');
      const second = await execute();
      assert.deepEqual((await second.result).outputs.translation.segments, [
        { segment_id: 's1', text: '你好。' }, { segment_id: 's2', text: '现在出发。' },
      ]);
      assert.equal(calls.length, 5);
      assert.deepEqual(calls.at(-1).body.messages, expected);
      assert.equal(await readFile(responsePath, 'utf8'), original);
      assert.equal(JSON.parse(original).text, '{"wrong":"ignored"}');
    });
    await t.test('sends native output schema with Responses and Anthropic Messages', async () => {
      for (const route of ['responses', 'anthropic']) {
        const { result } = await execute({ route });
        assert.equal((await result).outputs.translation.segments.length, 2);
        const { path, body } = calls.at(-1);
        const isResponses = route === 'responses';
        const format = isResponses ? body.text.format : body.output_config.format;
        assert.equal(format.type, 'json_schema');
        assert.deepEqual(format.schema.required, ['zh']);
        assert.equal(body.max_output_tokens ?? body.max_tokens, 65535);
        assert.equal(path, isResponses ? '/v1/responses' : '/v1/messages');
        assert.deepEqual((body.input ?? body.messages).slice(-3).map(m => m.role), ['user', 'assistant', 'user']);
      }
    });
    await t.test('the built-in DeepSeek route sends structured output to the official Responses path', async t => {
      const fetch = globalThis.fetch;
      t.mock.method(globalThis, 'fetch', (input, options) => {
        const url = new URL(input instanceof Request ? input.url : input);
        assert.equal(url.origin, 'https://api.deepseek.com');
        return fetch(baseURL + url.pathname, options);
      });
      const { result } = await execute({ route: 'deepseek', model: 'deepseek-flash' });
      assert.equal((await result).outputs.translation.segments.length, 2);
      const { body, path } = calls.at(-1);
      assert.equal(path, '/responses');
      assert.equal(body.max_output_tokens, 65535);
      assert.equal(body.text.format.type, 'json_schema');
      assert.deepEqual(body.reasoning, { effort: 'none' });
      assert.deepEqual(body.input.map(m => m.role), ['system', 'user', 'assistant', 'user']);
    });
    await t.test('refuses incompatible limits before sending a request', async () => {
      const before = calls.length;
      await assert.rejects((await execute({ route: 'small' })).result, /required output limit 65535/);
      await assert.rejects((await execute({ route: 'noCap' })).result, /required output limit 65535/);
      await assert.rejects((await execute({ model: 'unknown-model' })).result, { code: 'UNKNOWN_MODEL' });
      assert.equal(calls.length, before);
    });
    await t.test('reports provider schema rejection without downgrading or retrying', async () => {
      reject = true;
      const before = calls.length;
      await assert.rejects((await execute({ sentences: ['Hello.'] })).result, /fixture provider rejected the schema/);
      assert.equal(calls.length, before + 1);
      assert.equal(calls.at(-1).body.response_format.type, 'json_schema');
    });
  } finally { await adapter.dispose(); await services.dispose(); await runtime.dispose(); await rm(taskDir, { recursive: true, force: true }); }
});
