import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from 'cordis'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { AppError, type OperationProvider, type WorkflowDocument, type NodeResultView } from '@youdub/sdk'
import { Processes, Settings } from './helpers/native-services.js'
import Store from '../src/store.js'
import Files from '../src/files.js'
import Catalog from '../src/catalog.js'
import Tasks from '../src/tasks.js'
import * as Graph from '../src/workflow-graph.js'
import { taskApi } from './helpers/task-api.js'

const documentSchema = { type: 'object', properties: { text: { type: 'string', minLength: 1 } }, required: ['text'], additionalProperties: false }
const artifactSchema = { type: 'object', properties: { id: { type: 'string' }, schemaId: { const: 'file/v1' } }, required: ['id', 'schemaId'], additionalProperties: false }
const outputs = [
  { name: 'document', kind: 'json' as const, schemaId: 'document/v1', required: true, schema: documentSchema },
  { name: 'file', kind: 'artifact' as const, schemaId: 'file/v1', required: true },
]
function graph(review = true): WorkflowDocument {
  return {
    format: 'youdub.workflow', formatVersion: 1, id: 'user.review', title: '测试订正流程',
    nodes: [
      { id: 'read', type: 'test.read', typeVersion: '1', provider: { id: 'test.documents' }, config: {}, autoContinue: !review },
      { id: 'finish', type: 'test.finish', typeVersion: '1', provider: { id: 'test.documents' }, config: { prefix: 'done:' }, autoContinue: !review },
    ],
    edges: [
      { id: 'source-read', source: { nodeId: '$inputs', portId: 'custom_source' }, target: { nodeId: 'read', portId: 'asset' } },
      { id: 'context-read', source: { nodeId: '$inputs', portId: 'context_file' }, target: { nodeId: 'read', portId: 'context' } },
      { id: 'read-finish', source: { nodeId: 'read', portId: 'document' }, target: { nodeId: 'finish', portId: 'document' } },
    ],
    inputs: ['custom_source', 'context_file'].map(id => ({ id, label: id, required: true, kind: 'artifact', schemaId: 'file/v1', acceptedMimeTypes: ['text/plain'] })),
    outputs: [{ id: 'result', label: '结果', kind: 'artifact', schemaId: 'file/v1', required: true, source: { nodeId: 'finish', portId: 'file' } }],
    presentation: { positions: { read: { x: 20, y: 20 }, finish: { x: 400, y: 20 } }, viewport: { x: 0, y: 0, zoom: 1 } },
  }
}

/** Product transport, graph compiler, SQLite and files; computation uses a local text provider. */
async function setup(t: any, execution: 'local' | 'remote' = 'local') {
  const root = await mkdtemp(join(tmpdir(), 'youdub-graph-api-')), ctx = new Context()
  let nativeRequest!: ReturnType<typeof taskApi>['request']
  const executions: { taskId: string; stepId: string; text: string }[] = []
  const provider: OperationProvider = {
    id: 'test.documents',
    describe: () => ({
      id: 'test.documents', label: 'Text test provider', pluginId: 'test.documents', pluginVersion: '1', integrity: 'fixed', available: true, execution,
      operations: [
        {
          id: 'test.read/v1', outputs, inputSchema: { type: 'object', properties: { asset: artifactSchema, context: artifactSchema, suffix: { type: 'string' } }, required: ['asset', 'context'], additionalProperties: false },
          node: {
            type: 'test.read', version: '1', label: 'Read text', category: 'test',
            inputs: ['asset', 'context'].map(id => ({ id, label: id, kind: 'artifact', acceptedSchemaIds: ['file/v1'], required: true })),
            runtimeInputSchema: { type: 'object', properties: { suffix: { type: 'string' } }, additionalProperties: false },
            configSchema: { type: 'object', additionalProperties: false }, defaults: {},
            corrections: { outputPorts: ['document'], schemaIds: ['document/v1'] },
          },
        },
        {
          id: 'test.finish/v1', outputs, inputSchema: { type: 'object', properties: { document: documentSchema }, required: ['document'], additionalProperties: false },
          node: {
            type: 'test.finish', version: '1', label: 'Finish text', category: 'test',
            inputs: [{ id: 'document', label: 'Document', kind: 'json', acceptedSchemaIds: ['document/v1'], required: true }],
            configSchema: { type: 'object', properties: { prefix: { type: 'string' } }, additionalProperties: false }, defaults: { prefix: '' },
            corrections: { outputPorts: ['document'], schemaIds: ['document/v1'] },
          },
        },
      ],
    }),
    probe: async () => ({ available: true }),
    async execute(request, context) {
      const text = request.operation === 'test.read/v1'
        ? (await readFile(await context.resolve(request.inputs.asset), 'utf8')) + '|' + (await readFile(await context.resolve(request.inputs.context), 'utf8')) + (request.inputs.suffix ?? '')
        : request.binding.options.prefix + request.inputs.document.text
      executions.push({ taskId: request.taskId, stepId: request.stepId, text })
      await writeFile(join(request.workDir, 'result.txt'), text, { flag: 'wx' })
      const file = await context.register({ path: 'result.txt', mimeType: 'text/plain', schemaId: 'file/v1' })
      return { state: 'completed', outputs: { document: { text }, file } }
    },
    validateCorrection: ({ baselineOutputs, patch }) => {
      if (!patch.document.text.trim()) throw new AppError('INVALID_CORRECTION', 'Text cannot be blank.', 422)
      return { ...baselineOutputs, document: { text: patch.document.text.trim() } }
    },
  }
  const app = await ctx.plugin(async context => {
    await context.plugin(Processes)
    await context.plugin(Catalog)
    await context.plugin(Files, { root })
    await context.plugin(Store, { root, repoRoot: process.cwd(), python: process.env.YOUDUB_TEST_PYTHON || resolve('.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python') })
    await context.plugin(Settings)
    await context.plugin({ inject: ['catalog'], apply(scope) { scope.effect(() => scope.catalog.registerProvider(provider)) } })
    await context.plugin(Graph, { integrity: 'graph-api-fixed' })
    await context.plugin(Tasks, { pollMs: 5 })
    await context.plugin({ inject: ['tasks', 'catalog', 'files', 'settings', 'store'], apply(scope) { nativeRequest = taskApi(scope).request } })
  })
  t.after(async () => {
    try { await ctx.parallel('app/stopping') }
    finally { await app.dispose(); await rm(root, { recursive: true }) }
  })
  ctx.emit('app/ready')
  const request = (path: string, method = 'GET', body?: unknown) => nativeRequest(path.startsWith('/api/') ? path : '/api/v2' + path, {
    method, headers: body !== undefined && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : undefined,
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
  })
  const json = async (response: Response, status = 200): Promise<any> => {
    const text = await response.text()
    assert.equal(response.status, status, text)
    return text ? JSON.parse(text) : null
  }
  const form = (document = graph(), id = randomUUID()) => {
    const data = new FormData()
    data.append('request', JSON.stringify({ id, workflowId: 'youdub.graph', config: {}, graphDocument: document, nodeRuntimeInputs: { read: { suffix: '!' } } }))
    data.append('input.custom_source', new Blob(['hello'], { type: 'text/plain' }), '原文.txt')
    data.append('input.context_file', new Blob(['context'], { type: 'text/plain' }), '上下文.txt')
    return { data, id }
  }
  const create = async (document = graph()) => { const input = form(document); return json(await request('/tasks', 'POST', input.data), 201) }
  const until = async (id: string, status: string) => {
    const deadline = Date.now() + 5000
    while (Date.now() < deadline) { const task = await json(await request(`/tasks/${id}`)); if (task.status === status) return task; await delay(10) }
    throw new Error(`Task ${id} never reached ${status}`)
  }
  const command = (node: NodeResultView) => ({ actionId: randomUUID(), expectedAttempt: node.attempt, expectedTaskRevision: node.taskRevision, expectedOutputRevision: node.outputRevision })
  return { ctx, request, json, form, create, until, command, executions }
}

test('workflow documents round-trip through Harness routes and SQLite CAS without overwriting another window', async t => {
  const { request, json } = await setup(t)
  const document = graph()
  const first = await json(await request('/workflow-documents', 'POST', { document }), 201)
  assert.equal(first.revision, 1)
  assert.equal(first.origin, 'user')
  assert.deepEqual((await json(await request(`/workflow-documents/${document.id}`))).document, document)
  const changed = { ...document, title: '修改后' }
  const updated = await json(await request(`/workflow-documents/${document.id}`, 'PUT', { document: changed, expectedRevision: 1 }))
  assert.equal(updated.revision, 2)
  assert.equal((await json(await request(`/workflow-documents/${document.id}`, 'PUT', { document, expectedRevision: 1 }), 409)).error.code, 'REVISION_CONFLICT')
  assert.deepEqual((await json(await request(`/workflow-documents/${document.id}`))).document, changed)
  await json(await request('/workflow-documents', 'POST', { document: { ...document, id: 'youdub.subtitles' } }), 409)
  await json(await request(`/workflow-documents/${document.id}?expectedRevision=1`, 'DELETE'), 409)
  await json(await request(`/workflow-documents/${document.id}?expectedRevision=2`, 'DELETE'), 204)
  assert.equal((await json(await request(`/workflow-documents/${document.id}`), 404)).error.code, 'WORKFLOW_DOCUMENT_NOT_FOUND')
})

test('workflow pagination reaches all user documents and includes templates only on the first page', async t => {
  const { request, json } = await setup(t)
  for (const id of ['one', 'two', 'three']) await json(await request('/workflow-documents', 'POST', { document: { ...graph(), id } }), 201)
  const first = await json(await request('/workflow-documents?limit=1&offset=0'))
  const second = await json(await request('/workflow-documents?limit=1&offset=1'))
  const third = await json(await request('/workflow-documents?limit=1&offset=2'))
  assert.equal(first.items.filter((item: any) => item.origin === 'builtin').length, 3)
  assert.equal(second.items.length, 1)
  assert.equal(third.items.length, 1)
  assert.equal(first.hasMore, true)
  assert.equal(third.hasMore, false)
  assert.deepEqual(new Set([...first.items, ...second.items, ...third.items].filter(item => item.origin === 'user').map(item => item.id)), new Set(['one', 'two', 'three']))
  await json(await request('/workflow-documents?limit=0'), 422)
})

test('remote nodes follow provider readiness without imposing a shared API key contract', async t => {
  const { ctx, request, json, create, until } = await setup(t, 'remote')
  assert.deepEqual((await ctx.settings.read()).connections, [])
  const validation = await json(await request('/workflow-documents/validate', 'POST', { document: graph(false) }))
  assert.equal(validation.valid, true)
  const task = await create(graph(false)), complete = await until(task.id, 'succeeded')
  assert.equal(complete.outputs.length, 1)
  assert.deepEqual((await ctx.tasks.record(task.id)).credentialRefs, {})

  const provider = ctx.catalog.provider('test.documents'), description = provider.describe()
  provider.describe = () => ({ ...description, available: false, unavailableReason: 'Remote service is unavailable.' })
  const unavailable = await json(await request('/workflow-documents/validate', 'POST', { document: graph(false) }))
  assert.equal(unavailable.valid, false)
  assert.ok(unavailable.diagnostics.some((item: any) => item.code === 'PROVIDER_UNAVAILABLE' && item.message === 'Remote service is unavailable.'))
  const input = new FormData()
  input.append('request', JSON.stringify({ id: randomUUID(), workflowId: 'youdub.graph', config: {}, graphDocument: graph(false) }))
  input.append('input.custom_source', new Blob(['hello'], { type: 'text/plain' }), 'source.txt')
  input.append('input.context_file', new Blob(['context'], { type: 'text/plain' }), 'context.txt')
  const failed = await json(await request('/tasks', 'POST', input), 422)
  assert.ok(failed.error.details.some((item: any) => item.code === 'PROVIDER_UNAVAILABLE'))
})

test('dynamic multipart graph inputs, review history, artifact ownership and final approval work across the Harness boundary', async t => {
  const { request, json, create, until, command, executions } = await setup(t)
  const task = await create(), paused = await until(task.id, 'paused')
  assert.deepEqual(Object.keys(paused.inputs).sort(), ['context_file', 'custom_source'])
  assert.equal(paused.sourceName, '原文.txt')
  const first = await json(await request(`/tasks/${task.id}/nodes/read`))
  assert.equal(first.step.outputs.document.text, 'hello|context!')
  assert.equal(first.approvedRevision, null)
  const originalFile = first.step.outputs.file.id
  const artifact = await request(`/tasks/${task.id}/artifacts/${originalFile}`)
  assert.equal(artifact.status, 200)
  assert.equal(await artifact.text(), 'hello|context!')
  assert.equal(artifact.headers.get('x-content-type-options'), 'nosniff')
  const other = await create(graph(false)); await until(other.id, 'succeeded')
  await json(await request(`/tasks/${other.id}/artifacts/${originalFile}`), 404)
  await json(await request(`/tasks/${task.id}/artifacts/constructor`), 404)
  await json(await request(`/tasks/${task.id}/artifacts/__proto__`), 404)
  const correction = { ...command(first), patch: { document: { text: '  approved translation  ' } } }
  const receipt = await json(await request(`/tasks/${task.id}/nodes/read/corrections`, 'POST', correction))
  assert.equal(receipt.status, 'paused'); assert.equal(receipt.outputRevision, 2); assert.equal(receipt.attempt, 1)
  assert.deepEqual(await json(await request(`/tasks/${task.id}/nodes/read/corrections`, 'POST', correction)), receipt)
  assert.deepEqual(await json(await request(`/tasks/${task.id}/actions/${correction.actionId}`)), receipt)
  await json(await request(`/tasks/${task.id}/nodes/read/corrections`, 'POST', { ...correction, continue: true }), 409)
  const historical = await json(await request(`/tasks/${task.id}/nodes/read/results/1`))
  assert.equal(historical.step.outputs.document.text, 'hello|context!')
  assert.equal(historical.step.outputs.file.id, originalFile)
  await json(await request(`/tasks/${task.id}/nodes/read/approve`, 'POST', command(first)), 409)
  const current = await json(await request(`/tasks/${task.id}/nodes/read`))
  assert.equal(current.step.outputs.document.text, 'approved translation')
  await json(await request(`/tasks/${task.id}/nodes/read/approve`, 'POST', command(current)))
  const finalPaused = await until(task.id, 'paused')
  assert.equal(finalPaused.steps.find((step: any) => step.id === 'finish').status, 'awaiting_review')
  const finalNode = await json(await request(`/tasks/${task.id}/nodes/finish`))
  assert.equal(finalNode.inputs.document.text, 'approved translation')
  const approved = await json(await request(`/tasks/${task.id}/nodes/finish/approve`, 'POST', command(finalNode)))
  assert.equal(approved.status, 'succeeded')
  const completed = await json(await request(`/tasks/${task.id}`))
  const output = await request(completed.outputs[0].url.replace('/api/v2', ''))
  assert.equal(await output.text(), 'done:approved translation')
  assert.deepEqual(executions.filter(item => item.taskId === task.id).map(item => item.stepId), ['read', 'finish'])
})

test('graph mutations reject forged JSON inputs or undeclared multipart slots', async t => {
  const { request, json, form } = await setup(t)
  const forged = { id: randomUUID(), workflowId: 'youdub.graph', config: {}, graphDocument: graph(), inputs: { custom_source: { id: randomUUID(), schemaId: 'file/v1' } } }
  assert.equal((await json(await request('/tasks', 'POST', forged), 422)).error.code, 'INVALID_INPUT')
  const input = form()
  input.data.append('input.unexpected', new Blob(['extra'], { type: 'text/plain' }), 'extra.txt')
  await json(await request('/tasks', 'POST', input.data), 422)
  const wrongMime = form()
  wrongMime.data.set('input.context_file', new Blob(['context'], { type: 'application/octet-stream' }), 'context.bin')
  await json(await request('/tasks', 'POST', wrongMime.data), 422)
  assert.deepEqual((await json(await request('/tasks'))).items, [])
})

test('graph rerun preview pins source results and derived outputs survive deletion of the original task', async t => {
  const { request, json, create, until, executions } = await setup(t)
  const task = await create(graph(false)); await until(task.id, 'succeeded')
  const document = graph(false)
  document.nodes[1].config.prefix = 'new:'
  const proposal = { id: randomUUID(), config: {}, graphDocument: document }
  const preview = await json(await request(`/tasks/${task.id}/rerun-preview`, 'POST', proposal))
  assert.deepEqual(preview.reusedSteps, ['read']); assert.deepEqual(preview.dirtySteps, ['finish'])
  const derived = await json(await request(`/tasks/${task.id}/rerun`, 'POST', { ...proposal, ...preview }), 201)
  const finished = await until(derived.id, 'succeeded')
  assert.deepEqual(executions.filter(item => item.taskId === derived.id).map(item => item.stepId), ['finish'])
  await json(await request(`/tasks/${task.id}?expectedAttempt=1`, 'DELETE'), 204)
  const node = await json(await request(`/tasks/${derived.id}/nodes/read`))
  assert.equal(await (await request(`/tasks/${derived.id}/artifacts/${node.step.outputs.file.id}`)).text(), 'hello|context!')
  assert.equal(await (await request(finished.outputs[0].url.replace('/api/v2', ''))).text(), 'new:hello|context!')
})

test('graph cancellation requires its current revision and terminal review commands cannot resume it', async t => {
  const { request, json, create, until, command } = await setup(t)
  const task = await create(), paused = await until(task.id, 'paused')
  await json(await request(`/tasks/${task.id}/cancel`, 'POST', { expectedAttempt: 1 }), 409)
  const cancelled = await json(await request(`/tasks/${task.id}/cancel`, 'POST', { expectedAttempt: 1, expectedTaskRevision: paused.revision }))
  assert.equal(cancelled.status, 'cancelled')
  const node = await json(await request(`/tasks/${task.id}/nodes/read`))
  assert.equal((await json(await request(`/tasks/${task.id}/nodes/read/approve`, 'POST', command(node)), 409)).error.code, 'REVIEW_NOT_ALLOWED')
})

test('explicit cancellation and a fresh preview can adopt an unapproved candidate in a derived task', async t => {
  const { request, json, create, until, command } = await setup(t)
  const task = await create(), paused = await until(task.id, 'paused')
  const proposal = { id: randomUUID(), config: {}, corrections: { read: { revision: 1, patch: { document: { text: 'adopted in a copy' } } } } }
  const previewBeforeCancel = await json(await request(`/tasks/${task.id}/rerun-preview`, 'POST', proposal))
  await json(await request(`/tasks/${task.id}/rerun`, 'POST', { ...proposal, ...previewBeforeCancel }), 409)
  await json(await request(`/tasks/${task.id}/cancel`, 'POST', { expectedAttempt: 1, expectedTaskRevision: paused.revision }))
  await json(await request(`/tasks/${task.id}/rerun`, 'POST', { ...proposal, ...previewBeforeCancel }), 409)
  const freshPreview = await json(await request(`/tasks/${task.id}/rerun-preview`, 'POST', proposal))
  const copy = await json(await request(`/tasks/${task.id}/rerun`, 'POST', { ...proposal, ...freshPreview }), 201)
  await until(copy.id, 'paused')
  const finish = await json(await request(`/tasks/${copy.id}/nodes/finish`))
  assert.equal(finish.inputs.document.text, 'adopted in a copy')
  const completed = await json(await request(`/tasks/${copy.id}/nodes/finish/approve`, 'POST', command(finish)))
  assert.equal(completed.status, 'succeeded')
  const original = await json(await request(`/tasks/${task.id}/nodes/read`))
  assert.equal(original.status, 'cancelled')
  assert.equal(original.approvedRevision, null)
  assert.equal(original.outputRevision, 1)
})

test('invalid graph diagnostics remain actionable and runtime constants cannot forge references', async t => {
  const { request, json, form } = await setup(t)
  const document = graph()
  document.edges[2].source.portId = 'missing'
  const checked = await json(await request('/workflow-documents/validate', 'POST', { document }))
  assert.equal(checked.valid, false)
  assert.ok(checked.diagnostics.some((diagnostic: any) => diagnostic.edgeId === 'read-finish'))
  const input = form(document)
  const rejected = await json(await request('/tasks', 'POST', input.data), 422)
  assert.equal(rejected.error.code, 'INVALID_GRAPH')
  assert.ok(rejected.error.details.some((diagnostic: any) => diagnostic.edgeId === 'read-finish'))
  for (const nodeRuntimeInputs of [null, { read: null }, { read: { suffix: { from: 'step', stepId: 'read', output: 'file' } } }, { read: { suffix: { id: 'foreign', schemaId: 'file/v1' } } }]) {
    // Null must be rejected at the public API too; it must not become an empty default object.
    const response = await request('/workflow-documents/validate', 'POST', { document: graph(), nodeRuntimeInputs })
    await json(response, 422)
  }
  for (const graphDocument of [null, [], { ...graph(), inputs: [null] }]) {
    const response = await request('/tasks', 'POST', { id: randomUUID(), workflowId: 'youdub.graph', config: {}, graphDocument })
    assert.equal((await json(response, 422)).error.code, 'INVALID_WORKFLOW')
  }
})
