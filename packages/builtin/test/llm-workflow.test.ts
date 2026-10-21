import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from 'cordis'
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import type { OperationProvider, WorkflowDocument } from '@youdub/sdk'
import Processes from '../src/process.js'
import Store from '../src/store.js'
import Files from '../src/files.js'
import Catalog from '../src/catalog.js'
import Settings from '../src/settings.js'
import Models from '../src/llm-models.js'
import Tasks from '../src/tasks.js'
import * as Graph from '../src/workflow-graph.js'
import { transcriptSchema, translationSchema } from '../src/media-schemas.js'
import { operations } from '../src/media-contracts.js'

const source: OperationProvider = {
  id: 'test.transcript',
  describe: () => ({ id: 'test.transcript', label: 'Fixture transcript', pluginId: 'test', pluginVersion: '1', integrity: 'fixed', available: true, execution: 'local', operations: [{ id: 'test.transcript/v1', inputSchema: { type: 'object', additionalProperties: false }, outputs: [{ name: 'transcript', kind: 'json', schemaId: 'transcript/v1', required: true, schema: transcriptSchema }], node: { type: 'test.transcript', version: '1', label: 'Fixed test data', category: 'test', inputs: [], configSchema: { type: 'object', additionalProperties: false }, defaults: {} } }] }),
  probe: async () => ({ available: true }),
  execute: async () => ({ state: 'completed', outputs: { transcript: { detected_language: 'en', segments: [{ id: 'hello', start_ms: 0, end_ms: 1000, text: 'Hello' }] } } }),
}
const exporter: OperationProvider = {
  id: 'test.export',
  describe: () => ({ id: 'test.export', label: 'Fixture export', pluginId: 'test', pluginVersion: '1', integrity: 'fixed', available: true, execution: 'local', operations: [{ id: 'test.export/v1', inputSchema: { type: 'object', properties: { translation: translationSchema }, required: ['translation'] }, outputs: [{ name: 'file', kind: 'artifact', schemaId: 'file/v1', required: true }], node: { type: 'test.export', version: '1', label: 'Write fixture result', category: 'test', inputs: [{ id: 'translation', label: 'Translation', kind: 'json', acceptedSchemaIds: ['translation/v1'], required: true }], configSchema: { type: 'object', additionalProperties: false }, defaults: {} } }] }),
  probe: async () => ({ available: true }),
  execute: async (request, context) => { await writeFile(join(request.workDir, 'translation.txt'), request.inputs.translation.segments[0].text); return { state: 'completed', outputs: { file: await context.register({ path: 'translation.txt', schemaId: 'file/v1', mimeType: 'text/plain' }) } } },
}
async function start(root: string, secrets: Map<string, string>) {
  const ctx = new Context()
  const app = await ctx.plugin(async context => {
    await context.plugin(Processes)
    await context.plugin(Store, { root, repoRoot: process.cwd(), python: process.env.YOUDUB_TEST_PYTHON || resolve('.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python') })
    await context.plugin(Files, { root }); await context.plugin(Catalog);
    await context.plugin(scope => { scope.reflect.provide('secrets', { get: async (ref: string) => secrets.get(ref) ?? null, set: async (ref: string, value: string) => { secrets.set(ref, value) } }) });
    await context.plugin(Settings); await context.plugin(Models)
    await context.plugin({ inject: ['catalog'], apply(scope) { scope.effect(() => scope.catalog.registerProvider(source)); scope.effect(() => scope.catalog.registerProvider(exporter)) } })
    await context.plugin(Graph, { integrity: 'test-graph' }); await context.plugin(Tasks, { pollMs: 5 })
  })
  return { ctx, app }
}
test('a graph executes its selected model snapshot, ignores unused missing credentials, and survives settings restart', async t => {
  const root = await mkdtemp(join(tmpdir(), 'youdub-llm-workflow-'))
  const received: any[] = []
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(chunk)
    received.push({ authorization: request.headers.authorization, body: JSON.parse(Buffer.concat(chunks).toString()) })
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    const content = JSON.stringify({ segments: [{ segment_id: 'hello', text: '你好' }] })
    for (const [delta, finish_reason] of [[{ role: 'assistant', content }, null], [{}, 'stop']]) response.write(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason }] })}\n\n`)
    response.end('data: [DONE]\n\n')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const secrets = new Map<string, string>()
  let { ctx, app } = await start(root, secrets)
  t.after(async () => { await app.dispose(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); await rm(root, { recursive: true }) })
  const profile = { api: 'openai-completions', baseURL: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`, apiKeyEnv: 'YOUDUB_WORKFLOW_FIXTURE', models: [{ id: 'fixture-model', maxTokens: 70000 }] }
  await ctx.models.mutate({ ns: 'llm-pi-ai', ops: [{ op: 'set', path: ['providers', 'fixture'], value: profile }, { op: 'set', path: ['providers', 'unused'], value: { ...profile, apiKeyEnv: 'YOUDUB_MISSING_FIXTURE' } }] })
  await ctx.models.credentialsSet(profile.apiKeyEnv, 'original-fixture-key')
  const document: WorkflowDocument = { format: 'youdub.workflow', formatVersion: 1, id: 'user.translation-fixture', title: 'Local protocol test', inputs: [], outputs: [{ id: 'result', label: 'Translation', kind: 'artifact', schemaId: 'file/v1', required: true, source: { nodeId: 'export', portId: 'file' } }], nodes: [
    { id: 'source', type: 'test.transcript', typeVersion: '1', provider: { id: source.id }, config: {}, autoContinue: true },
    { id: 'translate', type: operations.translate.node!.type, typeVersion: operations.translate.node!.version, provider: { id: 'llm.fixture', model: 'fixture-model', device: 'remote' }, config: { targetLanguage: 'zh', sourceLanguage: 'auto', maxCompletionTokens: 65535 }, autoContinue: true },
    { id: 'export', type: 'test.export', typeVersion: '1', provider: { id: 'test.export' }, config: {}, autoContinue: true },
  ], edges: [{ id: 'result', source: { nodeId: 'translate', portId: 'translation' }, target: { nodeId: 'export', portId: 'translation' } }, { id: 'text', source: { nodeId: 'source', portId: 'transcript' }, target: { nodeId: 'translate', portId: 'transcript' } }], presentation: { positions: {}, viewport: { x: 0, y: 0, zoom: 1 } } }
  assert.deepEqual(Graph.inspectGraph(document, ctx.catalog).diagnostics, [])
  const id = randomUUID(); (await ctx.files.reserve(id, true))()
  await ctx.tasks.create({ id, workflowId: 'youdub.graph', config: {}, inputs: {}, graphDocument: document })
  const pinned = await ctx.tasks.record(id)
  assert.deepEqual(pinned.connections.map(item => item.adapter), ['llm.fixture'])
  await ctx.models.credentialsSet(profile.apiKeyEnv, 'replacement-fixture-key')
  await ctx.models.mutate({ ns: 'llm-pi-ai', ops: [{ op: 'set', path: ['providers', 'fixture'], value: { ...profile, baseURL: 'http://127.0.0.1:1/changed' } }] })
  ctx.emit('app/ready')
  let done = await ctx.tasks.record(id)
  for (let index = 0; index < 500 && !['succeeded', 'failed'].includes(done.status); index++) { await delay(10); done = await ctx.tasks.record(id) }
  assert.equal(done.status, 'succeeded', JSON.stringify(done.error))
  assert.deepEqual(done.steps[1].outputs.translation.segments, [{ segment_id: 'hello', text: '你好' }])
  assert.equal(received.length, 1); assert.equal(received[0].authorization, 'Bearer original-fixture-key'); assert.equal(received[0].body.max_completion_tokens, 65535)
  await ctx.models.mutate({ ns: 'llm-pi-ai', ops: [{ op: 'unset', path: ['providers', 'fixture'] }] })
  await app.dispose(); ({ ctx, app } = await start(root, secrets))
  assert.equal(ctx.catalog.provider('llm.fixture').describe().legacy, true)
  assert.equal((await ctx.settings.credentials(await ctx.tasks.record(id)))['llm.fixture'].api_key, 'original-fixture-key')
  assert.equal((await ctx.tasks.record(id)).status, 'succeeded')
})
