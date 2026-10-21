import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context, type Fiber } from 'cordis'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { AppError, type GraphWorkflowDefinition, type OperationProvider, type WorkflowDocument, type TaskView, type ReviewCommand, type StepState, type Invocation, type InvocationContext } from '@youdub/sdk'
import Processes from '../src/process.js'
import Store from '../src/store.js'
import Files from '../src/files.js'
import Catalog from '../src/catalog.js'
import Secrets from '../src/secrets.js'
import Settings from '../src/settings.js'
import Tasks from '../src/tasks.js'

function graph(gate?: string): WorkflowDocument {
  return {
    format: 'youdub.workflow', formatVersion: 1, id: 'test.graph', title: 'Test graph',
    nodes: ['source', 'left', 'right', 'join'].map(id => ({ id, type: 'test.document', typeVersion: '1', provider: { id: 'test.graph-provider' }, config: {}, autoContinue: id !== gate })),
    edges: [
      { id: 'source-left', source: { nodeId: 'source', portId: 'document' }, target: { nodeId: 'left', portId: 'document' } },
      { id: 'source-right', source: { nodeId: 'source', portId: 'document' }, target: { nodeId: 'right', portId: 'document' } },
      { id: 'left-join', source: { nodeId: 'left', portId: 'document' }, target: { nodeId: 'join', portId: 'left' } },
      { id: 'right-join', source: { nodeId: 'right', portId: 'document' }, target: { nodeId: 'join', portId: 'right' } },
    ],
    inputs: [], outputs: [{ id: 'file', label: 'File', kind: 'artifact', schemaId: 'file/v1', required: true, source: { nodeId: 'join', portId: 'file' } }],
    presentation: { positions: {}, viewport: { x: 0, y: 0, zoom: 1 } },
  }
}

async function setup(t: any) {
  const root = await mkdtemp(join(tmpdir(), 'youdub-graph-')), ctx = new Context(), fibers: Fiber[] = []
  fibers.push(await ctx.plugin(Processes), await ctx.plugin(Catalog), await ctx.plugin(Files, { root }))
  fibers.push(await ctx.plugin(Store, { root, repoRoot: process.cwd(), python: process.env.YOUDUB_TEST_PYTHON || resolve('.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python') }))
  fibers.push(await ctx.plugin(Secrets), await ctx.plugin(Settings))
  let taskFiber = await ctx.plugin(Tasks, { pollMs: 5 })
  t.after(async () => {
    try { await ctx.parallel('app/stopping') }
    finally { await taskFiber.dispose(); for (const fiber of [...fibers].reverse()) await fiber.dispose(); await rm(root, { recursive: true }) }
  })
  const identity = { pluginId: 'test.graph', pluginVersion: '1.0.0', integrity: 'graph-fixed' }
  const ports = [
    { name: 'document', kind: 'json' as const, schemaId: 'document/v1', required: true, schema: { type: 'object', required: ['text'], properties: { text: { type: 'string' }, file: { type: 'object', required: ['id', 'schemaId'], properties: { id: { type: 'string' }, schemaId: { const: 'file/v1' } }, additionalProperties: false } }, additionalProperties: false } },
    { name: 'file', kind: 'artifact' as const, schemaId: 'file/v1', required: true },
  ]
  const executions: { taskId: string; stepId: string; inputs: any }[] = []
  const provider: OperationProvider = {
    id: 'test.graph-provider',
    describe: () => ({ id: 'test.graph-provider', label: 'Graph test', ...identity, operations: [{
      id: 'test.document/v1', inputSchema: { type: 'object' }, outputs: ports,
      node: { type: 'test.document', version: '1', label: 'Document', category: 'Test', inputs: [], configSchema: { type: 'object' }, defaults: {}, corrections: { outputPorts: ['document'], schemaIds: ['document/v1'] } },
    }] }),
    probe: async () => ({ available: true }),
    async execute(request, context) {
      executions.push({ taskId: request.taskId, stepId: request.stepId, inputs: structuredClone(request.inputs) })
      const text = Object.values(request.inputs).map((input: any) => input.text).join(' + ') + `/${request.binding.options.text ?? request.stepId}`
      await writeFile(join(request.workDir, 'result.txt'), text, { flag: 'wx' })
      const file = await context.register({ path: 'result.txt', mimeType: 'text/plain', schemaId: 'file/v1' })
      return { state: 'completed', outputs: { document: { text }, file } }
    },
    validateCorrection: ({ baselineOutputs, patch }) => {
      if (!patch.document.text.trim()) throw new AppError('INVALID_CORRECTION', 'Text must not be empty.', 422)
      return { ...baselineOutputs, document: { ...patch.document, text: patch.document.text.trim() } }
    },
  }
  const workflow: GraphWorkflowDefinition = {
    id: 'test.graph-workflow', version: '1.0.0', ...identity,
    describe: () => ({ id: 'test.graph-workflow', version: '1.0.0', label: 'Graph test', inputs: [], configSchema: { type: 'object' }, defaults: {} }),
    graph: { async compile({ document, nodeRuntimeInputs }) {
      return {
        graphSnapshot: structuredClone(document),
        plan: {
          workflow: { id: 'test.graph-workflow', version: '1.0.0', ...identity }, config: { graph: true },
          bindings: Object.fromEntries(document.nodes.map(node => [node.id, { ...identity, providerId: provider.id, modelRevision: null, options: node.config }])),
          steps: document.nodes.map(node => ({
            id: node.id, label: node.label ?? node.id, bindingKey: node.id, operation: 'test.document/v1', autoContinue: node.autoContinue, outputs: ports,
            input: { ...Object.fromEntries(document.edges.filter(edge => edge.target.nodeId === node.id).map(edge => [edge.target.portId, { from: 'step', stepId: edge.source.nodeId, output: edge.source.portId }])), ...nodeRuntimeInputs[node.id] },
          })),
          outputs: document.outputs.map(output => ({ id: output.id, label: output.label, role: 'file', required: output.required, source: { stepId: output.source.nodeId, output: output.source.portId } })),
        },
      }
    } },
  }
  fibers.push(await ctx.plugin({ inject: ['catalog'], apply(context) { context.effect(() => context.catalog.registerProvider(provider)); context.effect(() => context.catalog.registerWorkflow(workflow)) } }))
  const create = async (document = graph()) => {
    const id = randomUUID(), release = await ctx.files.reserve(id, true)
    try { return await ctx.tasks.create({ id, workflowId: workflow.id, config: {}, graphDocument: document, inputs: {} }) }
    finally { await release() }
  }
  const until = async (id: string, status: string): Promise<TaskView> => {
    const deadline = Date.now() + 5000
    while (Date.now() < deadline) { const task = await ctx.tasks.get(id); if (task.status === status) return task; await delay(10) }
    throw new Error(`Expected ${status}: ${JSON.stringify(await ctx.tasks.get(id))}`)
  }
  const command = (task: TaskView, nodeId: string): ReviewCommand => ({ actionId: randomUUID(), expectedAttempt: task.attempt, expectedTaskRevision: task.revision, expectedOutputRevision: task.steps.find((step: StepState) => step.id === nodeId)!.outputRevision! })
  const restart = async () => {
    await ctx.parallel('app/stopping'); await taskFiber.dispose()
    taskFiber = await ctx.plugin(Tasks, { pollMs: 5 }); ctx.emit('app/ready')
  }
  ctx.emit('app/ready')
  return { ctx, create, until, command, executions, provider, restart }
}

test('a persisted review releases the slot, survives restart and resumes without executing the reviewed node again', async t => {
  const { ctx, create, until, command, executions, restart } = await setup(t)
  const first = await create(graph('left')), paused = await until(first.id, 'paused')
  assert.equal(paused.steps[1].status, 'awaiting_review')
  assert.equal(paused.steps[2].status, 'completed')
  assert.equal(paused.steps[3].status, 'pending')
  assert.equal(paused.nextPollAt, null)
  assert.equal(await ctx.tasks.idle(), false)
  const second = await create()
  await until(second.id, 'succeeded')
  await restart()
  assert.deepEqual(await ctx.tasks.get(first.id), paused)
  await ctx.tasks.approve(first.id, 'left', command(paused, 'left'))
  await until(first.id, 'succeeded')
  assert.deepEqual(executions.filter(item => item.taskId === first.id).map(item => item.stepId), ['source', 'left', 'right', 'join'])
})

test('the final node remains paused until approval and finalizes directly in the approval receipt', async t => {
  const { ctx, create, until, command, executions } = await setup(t)
  const task = await create(graph('join')), paused = await until(task.id, 'paused')
  assert.equal(paused.outputs.length, 0)
  const request = command(paused, 'join'), receipt = await ctx.tasks.approve(task.id, 'join', request)
  assert.equal(receipt.status, 'succeeded')
  assert.equal((await ctx.tasks.get(task.id)).outputs.length, 1)
  assert.deepEqual(await ctx.tasks.approve(task.id, 'join', request), receipt)
  assert.deepEqual(await ctx.tasks.action(task.id, request.actionId), receipt)
  assert.equal(executions.length, 4)
})

test('independent gates survive restart and each approval advances only its ready descendants', async t => {
  const { ctx, create, until, command, executions, restart } = await setup(t)
  const document = graph('left')
  document.nodes.find(node => node.id === 'right')!.autoContinue = false
  document.nodes.splice(3, 0, { ...structuredClone(document.nodes[1]), id: 'left-next' })
  document.edges.find(edge => edge.id === 'left-join')!.source.nodeId = 'left-next'
  document.edges.push({ id: 'left-next', source: { nodeId: 'left', portId: 'document' }, target: { nodeId: 'left-next', portId: 'document' } })
  const created = await create(document), paused = await until(created.id, 'paused')
  assert.deepEqual(paused.steps.map((step: StepState) => step.status), ['completed', 'awaiting_review', 'awaiting_review', 'pending', 'pending'])
  await restart()
  assert.deepEqual(await ctx.tasks.get(created.id), paused)
  // A decision on the other branch must not invalidate an unchanged node result.
  const rightApproval = command(paused, 'right')
  await ctx.tasks.approve(created.id, 'left', command(paused, 'left'))
  const secondGate = await until(created.id, 'paused')
  assert.deepEqual(secondGate.steps.map((step: StepState) => step.status), ['completed', 'completed', 'awaiting_review', 'awaiting_review', 'pending'])
  await ctx.tasks.approve(created.id, 'left-next', command(secondGate, 'left-next'))
  assert.equal((await ctx.tasks.get(created.id)).steps.at(-1)!.status, 'pending')
  await ctx.tasks.approve(created.id, 'right', rightApproval)
  await until(created.id, 'succeeded')
  assert.deepEqual(executions.map(item => item.stepId), ['source', 'left', 'right', 'left-next', 'join'])
})

test('independent review commands based on the same task snapshot both commit', async t => {
  const { ctx, create, until, command } = await setup(t)
  const document = graph('left')
  document.nodes.find(node => node.id === 'right')!.autoContinue = false
  const created = await create(document), paused = await until(created.id, 'paused')
  const results = await Promise.all([
    ctx.tasks.approve(created.id, 'left', command(paused, 'left')),
    ctx.tasks.approve(created.id, 'right', command(paused, 'right')),
  ])
  assert.equal(results.length, 2)
  const complete = await until(created.id, 'succeeded')
  assert.equal(complete.steps[1].approvedRevision, 1)
  assert.equal(complete.steps[2].approvedRevision, 1)
})

test('review during another running branch preserves its invocation and ignores unrelated progress revisions', async t => {
  const { ctx, create, until, command, provider, executions } = await setup(t)
  let release!: () => void, entered!: () => void, progress!: () => Promise<void>
  const held = new Promise<void>(resolve => { release = resolve })
  const started = new Promise<void>(resolve => { entered = resolve })
  t.after(() => release())
  const execute = provider.execute.bind(provider)
  t.mock.method(provider, 'execute', async (request: Invocation, context: InvocationContext) => {
    if (request.stepId === 'right') {
      progress = () => context.progress(0.5, 'Independent branch is running')
      entered(); await held
    }
    return execute(request, context)
  })
  const created = await create(graph('left'))
  await started
  const running = await ctx.tasks.get(created.id), request = command(running, 'left')
  assert.equal(running.status, 'running')
  assert.equal(running.steps[1].status, 'awaiting_review')
  await progress()
  const receipt = await ctx.tasks.correct(created.id, 'left', { ...request, patch: { document: { text: 'reviewed while running' } }, continue: true })
  assert.equal(receipt.status, 'running')
  assert.equal((await ctx.tasks.get(created.id)).steps[2].status, 'running')
  release()
  await until(created.id, 'succeeded')
  assert.equal(executions.find(item => item.stepId === 'join')!.inputs.left.text, 'reviewed while running')
})

test('corrections preserve original output and raw files; save-and-continue atomically pins the corrected downstream input', async t => {
  const { ctx, create, until, command, executions } = await setup(t)
  const task = await create(graph('left')), paused = await until(task.id, 'paused')
  const before = await ctx.tasks.record(task.id), original = before.steps[1]
  const request = { ...command(paused, 'left'), patch: { document: { text: '  corrected text  ' } }, continue: true }
  const receipt = await ctx.tasks.correct(task.id, 'left', request)
  assert.equal(receipt.outputRevision, 2)
  await until(task.id, 'succeeded')
  const after = await ctx.tasks.record(task.id), revised = after.steps[1]
  assert.deepEqual(revised.resultRevisions![0].outputs, original.outputs)
  assert.deepEqual(revised.outputs.file, original.outputs.file)
  assert.equal(revised.approvedRevision, 2)
  assert.equal(revised.resultRevisions![1].source, 'correction')
  assert.equal(executions.find(item => item.taskId === task.id && item.stepId === 'join')!.inputs.left.text, 'corrected text')
  assert.deepEqual(await ctx.tasks.correct(task.id, 'left', request), receipt)
  await assert.rejects(ctx.tasks.correct(task.id, 'left', { ...request, continue: false }), (error: any) => error.code === 'ACTION_CONFLICT')
  const history = await ctx.tasks.node(task.id, 'left', 1)
  assert.deepEqual(history.step.outputs, original.outputs)
  assert.equal(executions.length, 4)
})

test('invalid patches, foreign artifacts and stale actions cannot mutate a paused node', async t => {
  const { ctx, create, until, command } = await setup(t)
  const task = await create(graph('left')), paused = await until(task.id, 'paused')
  const another = await create(), complete = await until(another.id, 'succeeded')
  const foreign = (await ctx.tasks.record(complete.id)).steps[0].outputs.file
  for (const patch of [{ file: foreign }, { document: { text: 'test', file: foreign } }, { document: { text: 12 } }, { document: { text: ' ' } }]) {
    await assert.rejects(ctx.tasks.correct(task.id, 'left', { ...command(paused, 'left'), patch }))
    assert.deepEqual(await ctx.tasks.get(task.id), paused)
  }
  const request = command(paused, 'left')
  await ctx.tasks.correct(task.id, 'left', { ...request, patch: { document: { text: 'saved' } } })
  const saved = await ctx.tasks.get(task.id)
  assert.equal(saved.status, 'paused')
  await assert.rejects(ctx.tasks.approve(task.id, 'left', command(paused, 'left')), (error: any) => error.code === 'OUTPUT_REVISION_CONFLICT')
  assert.equal(saved.steps[1].outputRevision, 2)
})

test('cancelling a review keeps computed history and rejects later approval', async t => {
  const { ctx, create, until, command } = await setup(t)
  const task = await create(graph('left')), paused = await until(task.id, 'paused')
  await assert.rejects(ctx.tasks.cancel(task.id, 1, paused.revision - 1), (error: any) => error.code === 'REVISION_CONFLICT')
  const cancelled = await ctx.tasks.cancel(task.id, 1, paused.revision)
  assert.equal(cancelled.status, 'cancelled')
  assert.deepEqual(cancelled.steps.map((step: StepState) => step.status), ['completed', 'cancelled', 'completed', 'cancelled'])
  assert.deepEqual(cancelled.steps[1].resultRevisions, paused.steps[1].resultRevisions)
  await assert.rejects(ctx.tasks.approve(task.id, 'left', command(cancelled, 'left')), (error: any) => error.code === 'REVIEW_NOT_ALLOWED')
})

test('dependency reuse recomputes only the changed branch and copies files independently of the source', async t => {
  const { ctx, create, until, executions } = await setup(t)
  const first = await create(), source = await until(first.id, 'succeeded')
  const document = graph()
  document.nodes.find(node => node.id === 'left')!.config.text = 'changed-left'
  const request = { id: randomUUID(), config: {}, graphDocument: document }
  const preview = await ctx.tasks.rerunPreview(first.id, request)
  assert.deepEqual(preview.reusedSteps, ['source', 'right'])
  assert.deepEqual(preview.dirtySteps, ['left', 'join'])
  const next = await ctx.tasks.rerun(first.id, { ...request, ...preview })
  await until(next.id, 'succeeded')
  assert.deepEqual(executions.filter(item => item.taskId === next.id).map(item => item.stepId), ['left', 'join'])
  const copied = await ctx.tasks.record(next.id)
  const reusedFile = copied.steps[0].outputs.file
  assert.notEqual(reusedFile.id, source.steps[0].outputs.file.id)
  await ctx.tasks.delete(first.id, 1)
  assert.equal(await readFile(await ctx.files.resolve(next.id, copied.artifacts[reusedFile.id]), 'utf8'), '/source')
})

test('adding review to reused results pauses immediately without model calls, including the final node', async t => {
  const { ctx, create, until, command, executions } = await setup(t)
  const first = await create(); await until(first.id, 'succeeded')
  const document = graph('left')
  document.nodes.find(node => node.id === 'join')!.autoContinue = false
  const request = { id: randomUUID(), config: {}, graphDocument: document }
  const preview = await ctx.tasks.rerunPreview(first.id, request)
  assert.deepEqual(preview.dirtySteps, [])
  const next = await ctx.tasks.rerun(first.id, { ...request, ...preview })
  assert.equal(next.status, 'paused')
  assert.equal(next.steps[1].status, 'awaiting_review')
  await ctx.tasks.approve(next.id, 'left', command(next, 'left'))
  const paused = await ctx.tasks.get(next.id)
  assert.equal(paused.status, 'paused')
  assert.equal(paused.steps[3].status, 'awaiting_review')
  const receipt = await ctx.tasks.approve(next.id, 'join', command(paused, 'join'))
  assert.equal(receipt.status, 'succeeded')
  assert.equal(executions.filter(item => item.taskId === next.id).length, 0)
})

test('correcting a reused review invalidates descendants, preserves history and respects subsequent gates', async t => {
  const { ctx, create, until, command, executions } = await setup(t)
  const first = await create(); await until(first.id, 'succeeded')
  const document = graph('left')
  for (const node of document.nodes) if (['right', 'join'].includes(node.id)) node.autoContinue = false
  const request = { id: randomUUID(), config: {}, graphDocument: document }
  const preview = await ctx.tasks.rerunPreview(first.id, request)
  const next = await ctx.tasks.rerun(first.id, { ...request, ...preview })
  const before = await ctx.tasks.record(next.id), originalJoin = structuredClone(before.steps[3])

  await ctx.tasks.correct(next.id, 'left', { ...command(next, 'left'), patch: { document: { text: 'corrected-after-reuse' } }, continue: true })
  const corrected = await ctx.tasks.get(next.id)
  assert.equal(corrected.status, 'paused')
  assert.equal(corrected.steps[1].status, 'completed')
  assert.equal(corrected.steps[1].approvedRevision, 2)
  assert.equal(corrected.steps[2].status, 'awaiting_review')
  assert.equal(corrected.steps[3].status, 'pending')
  assert.equal(corrected.steps[3].outputRevision, 0)
  assert.equal(corrected.steps[3].approvedRevision, null)
  assert.deepEqual(corrected.steps[3].outputs, {})
  assert.deepEqual(corrected.steps[3].resultRevisions, originalJoin.resultRevisions)
  assert.deepEqual(corrected.steps[2].outputs, before.steps[2].outputs)
  assert.deepEqual(corrected.steps[2].resultRevisions, before.steps[2].resultRevisions)
  assert.equal(executions.filter(item => item.taskId === next.id).length, 0)
  await ctx.tasks.approve(next.id, 'right', command(corrected, 'right'))
  const joined = await until(next.id, 'paused')
  assert.equal(joined.steps[3].status, 'awaiting_review')
  assert.equal(joined.steps[3].outputRevision, 2)
  assert.deepEqual(joined.steps[3].resultRevisions![0], originalJoin.resultRevisions![0])
  assert.equal(joined.steps[3].outputs.document.text, 'corrected-after-reuse + /source/right/join')
  assert.deepEqual(executions.filter(item => item.taskId === next.id).map(item => item.stepId), ['join'])
  await ctx.tasks.approve(next.id, 'join', command(joined, 'join'))
  const complete = await until(next.id, 'succeeded')
  assert.equal(complete.outputs.length, 1)
  const historical = await ctx.tasks.node(next.id, 'join', 1), result = await ctx.tasks.record(next.id)
  assert.equal(await readFile(await ctx.files.resolve(next.id, result.artifacts[historical.step.outputs.file.id]), 'utf8'), '/source/left + /source/right/join')
})

test('cancelling after a reused review correction retains invalidated history and files through restart', async t => {
  const { ctx, create, until, command, restart } = await setup(t)
  const first = await create(); await until(first.id, 'succeeded')
  const request = { id: randomUUID(), config: {}, graphDocument: graph('left') }
  const preview = await ctx.tasks.rerunPreview(first.id, request)
  const next = await ctx.tasks.rerun(first.id, { ...request, ...preview })
  const before = await ctx.tasks.record(next.id)
  await ctx.tasks.correct(next.id, 'left', { ...command(next, 'left'), patch: { document: { text: 'saved-before-cancel' } } })
  const corrected = await ctx.tasks.get(next.id)
  await ctx.tasks.cancel(next.id, corrected.attempt, corrected.revision)
  await restart()
  const cancelled = await ctx.tasks.record(next.id)
  assert.equal(cancelled.status, 'cancelled')
  assert.equal(cancelled.steps[3].status, 'cancelled')
  assert.equal(cancelled.steps[3].outputRevision, 0)
  assert.deepEqual(cancelled.steps[3].resultRevisions, before.steps[3].resultRevisions)
  assert.equal(cancelled.steps[1].resultRevisions!.at(-1)!.outputs.document.text, 'saved-before-cancel')
  assert.deepEqual(cancelled.artifacts, before.artifacts)
  const oldFile = cancelled.steps[3].resultRevisions![0].outputs.file
  assert.equal(await readFile(await ctx.files.resolve(next.id, cancelled.artifacts[oldFile.id]), 'utf8'), '/source/left + /source/right/join')
})

test('derived correction is a new version and invalidates only its downstream dependency closure', async t => {
  const { ctx, create, until, executions } = await setup(t)
  const first = await create(), original = await until(first.id, 'succeeded')
  const request = { id: randomUUID(), config: {}, corrections: { left: { revision: 1, patch: { document: { text: 'new-translation' } } } } }
  const preview = await ctx.tasks.rerunPreview(first.id, request)
  assert.deepEqual(preview.reusedSteps, ['source', 'right'])
  assert.deepEqual(preview.correctedSteps, ['left'])
  assert.deepEqual(preview.dirtySteps, ['join'])
  const next = await ctx.tasks.rerun(first.id, { ...request, ...preview })
  await until(next.id, 'succeeded')
  const result = await ctx.tasks.record(next.id)
  assert.deepEqual(executions.filter(item => item.taskId === next.id).map(item => item.stepId), ['join'])
  assert.equal(result.steps[1].outputRevision, 2)
  assert.equal(result.steps[1].approvedRevision, 2)
  assert.equal(result.steps[1].outputs.document.text, 'new-translation')
  assert.deepEqual(await ctx.tasks.get(first.id), original)
  assert.equal(executions.find(item => item.taskId === next.id)!.inputs.left.text, 'new-translation')
})

test('competing approve and correction commands commit once and preserve the winning revision', async t => {
  const { ctx, create, until, command } = await setup(t)
  const task = await create(graph('left')), paused = await until(task.id, 'paused')
  const results = await Promise.allSettled([
    ctx.tasks.correct(task.id, 'left', { ...command(paused, 'left'), patch: { document: { text: 'winning correction' } } }),
    ctx.tasks.approve(task.id, 'left', command(paused, 'left')),
  ])
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
  const failed = results.find(result => result.status === 'rejected') as PromiseRejectedResult
  assert.equal(failed.reason.code, 'OUTPUT_REVISION_CONFLICT')
  const current = await ctx.tasks.get(task.id)
  assert.equal(current.status, 'paused')
  assert.equal(current.steps[1].outputs.document.text, 'winning correction')
})

test('an unknown correction commit is visible and can be resolved by its durable action receipt', async t => {
  const { ctx, create, until, command, executions } = await setup(t)
  const task = await create(graph('left')), paused = await until(task.id, 'paused')
  const request = { ...command(paused, 'left'), patch: { document: { text: 'persisted before disconnect' } } }
  const call = ctx.store.call.bind(ctx.store)
  let injected = false
  t.mock.method(ctx.store, 'call', async (method: string, params: any) => {
    const result = await call(method, params)
    if (!injected && method === 'store.cas' && params.task.actionReceipts?.[request.actionId]) {
      injected = true
      throw new AppError('COMMIT_OUTCOME_UNKNOWN', 'Connection closed after committing the correction.', 503)
    }
    return result
  })
  await assert.rejects(ctx.tasks.correct(task.id, 'left', request), (error: any) => error.code === 'COMMIT_OUTCOME_UNKNOWN')
  const receipt = await ctx.tasks.action(task.id, request.actionId)
  assert.equal(receipt?.outputRevision, 2)
  assert.equal(receipt?.status, 'paused')
  assert.deepEqual(await ctx.tasks.correct(task.id, 'left', request), receipt)
  assert.equal((await ctx.tasks.record(task.id)).steps[1].resultRevisions!.length, 2)
  assert.equal(executions.length, 3)
})

test('reuse rejects changed source revisions and missing artifacts before creating a task', async t => {
  const { ctx, create, until } = await setup(t)
  const task = await create(); await until(task.id, 'succeeded')
  const request = { id: randomUUID(), config: {} }, preview = await ctx.tasks.rerunPreview(task.id, request)
  await assert.rejects(ctx.tasks.rerun(task.id, { ...request, ...preview, sourceRevisions: { ...preview.sourceRevisions, left: 10 } }), (error: any) => error.code === 'OUTPUT_REVISION_CONFLICT')
  await assert.rejects(ctx.tasks.record(request.id), (error: any) => error.code === 'TASK_NOT_FOUND')
  const source = await ctx.tasks.record(task.id)
  await rm(await ctx.files.resolve(task.id, source.artifacts[source.steps[1].outputs.file.id]))
  await assert.rejects(ctx.tasks.rerunPreview(task.id, { id: randomUUID(), config: {} }), (error: any) => error.code === 'ENOENT')
})

test('valid node IDs that match object property names do not invent corrections or force recomputation', async t => {
  const { ctx, create, until, executions } = await setup(t)
  const document = graph()
  document.nodes[0].id = 'constructor'
  document.edges.forEach(edge => { if (edge.source.nodeId === 'source') edge.source.nodeId = 'constructor' })
  const task = await create(document); await until(task.id, 'succeeded')
  const request = { id: randomUUID(), config: {} }, preview = await ctx.tasks.rerunPreview(task.id, request)
  assert.deepEqual(preview.reusedSteps, ['constructor', 'left', 'right', 'join'])
  assert.deepEqual(preview.dirtySteps, [])
  const derived = await ctx.tasks.rerun(task.id, { ...request, ...preview })
  assert.equal(derived.status, 'succeeded')
  assert.equal(executions.filter(item => item.taskId === derived.id).length, 0)
})

test('reused intermediate results cannot bypass a new upstream review', async t => {
  const { ctx, create, until, command, executions } = await setup(t)
  const first = await create(); await until(first.id, 'succeeded')
  const document = graph('source')
  document.nodes.find(node => node.id === 'join')!.config.text = 'changed join'
  const request = { id: randomUUID(), config: {}, graphDocument: document }
  const preview = await ctx.tasks.rerunPreview(first.id, request)
  assert.deepEqual(preview.reusedSteps, ['source', 'left', 'right'])
  assert.deepEqual(preview.dirtySteps, ['join'])
  const next = await ctx.tasks.rerun(first.id, { ...request, ...preview })
  const paused = await until(next.id, 'paused')
  assert.equal(paused.steps[0].status, 'awaiting_review')
  assert.equal(paused.steps[3].status, 'pending')
  assert.deepEqual(executions.filter(item => item.taskId === next.id).map(item => item.stepId), [])
  await ctx.tasks.approve(next.id, 'source', command(paused, 'source'))
  await until(next.id, 'succeeded')
  assert.deepEqual(executions.filter(item => item.taskId === next.id).map(item => item.stepId), ['join'])
})

test('review while another branch waits preserves its polling state across restart', async t => {
  const { ctx, create, until, command, provider, executions, restart } = await setup(t)
  const execute = provider.execute.bind(provider)
  let remoteRequest: Invocation, submissions = 0, polls = 0
  t.mock.method(provider, 'execute', async (request: Invocation, context: InvocationContext) => {
    if (request.stepId === 'right') {
      submissions++; remoteRequest = request
      return { state: 'waiting', operation: { marker: request.invocationId }, nextPollAt: new Date(Date.now() + 500).toISOString() }
    }
    return execute(request, context)
  })
  provider.poll = async (operation, context) => {
    polls++; assert.equal(operation.marker, remoteRequest.invocationId)
    return execute(remoteRequest, context)
  }
  const created = await create(graph('left')), waiting = await until(created.id, 'waiting')
  assert.equal(waiting.steps[1].status, 'awaiting_review')
  const receipt = await ctx.tasks.correct(created.id, 'left', { ...command(waiting, 'left'), patch: { document: { text: 'reviewed while waiting' } }, continue: true })
  assert.equal(receipt.status, 'waiting')
  const reviewed = await ctx.tasks.get(created.id)
  assert.equal(reviewed.nextPollAt, waiting.nextPollAt)
  assert.equal(reviewed.steps[2].invocationId, waiting.steps[2].invocationId)
  await restart()
  const completed = await until(created.id, 'succeeded')
  assert.equal(completed.steps[2].invocationId, waiting.steps[2].invocationId)
  assert.equal(submissions, 1); assert.equal(polls, 1)
  assert.equal(executions.find(item => item.stepId === 'join')!.inputs.left.text, 'reviewed while waiting')
})

test('cancelling waiting with a review preserves history and rejects a later confirmation', async t => {
  const { ctx, create, until, command, provider, restart } = await setup(t)
  const execute = provider.execute.bind(provider)
  t.mock.method(provider, 'execute', async (request: Invocation, context: InvocationContext) => {
    if (request.stepId === 'right') {
      await context.externalPrepare({ externalRequestId: 'remote-waiting', requestKey: request.invocationId })
      return { state: 'waiting', operation: { marker: request.invocationId }, nextPollAt: new Date(Date.now() + 60_000).toISOString() }
    }
    return execute(request, context)
  })
  provider.poll = async () => { throw new Error('Cancelled request must not be polled') }
  const created = await create(graph('left')), waiting = await until(created.id, 'waiting')
  await ctx.tasks.cancel(created.id, waiting.attempt, waiting.revision)
  await until(created.id, 'cancelled')
  await assert.rejects(ctx.tasks.approve(created.id, 'left', command(waiting, 'left')), { code: 'REVIEW_NOT_ALLOWED' })
  await restart()
  const cancelled = await ctx.tasks.record(created.id)
  assert.deepEqual(cancelled.steps.map(step => step.status), ['completed', 'cancelled', 'cancelled', 'cancelled'])
  assert.deepEqual(cancelled.steps[1].resultRevisions, waiting.steps[1].resultRevisions)
  assert.equal(cancelled.nextPollAt, null)
  assert.equal(cancelled.externalRequests['remote-waiting'].state, 'unknown')
  assert.equal(cancelled.externalRequests['remote-waiting'].mayStillRun, true)
  const file = cancelled.steps[1].resultRevisions![0].outputs.file
  assert.equal(await readFile(await ctx.files.resolve(created.id, cancelled.artifacts[file.id]), 'utf8'), '/source/left')
})

test('review in the claim-to-invocation gap retains the active execution slot', async t => {
  const { ctx, create, until, command, executions } = await setup(t)
  const workDir = ctx.files.workDir.bind(ctx.files)
  let calls = 0, entered!: () => void, release!: () => void
  const started = new Promise<void>(resolve => { entered = resolve })
  const held = new Promise<void>(resolve => { release = resolve })
  t.mock.method(ctx.files, 'workDir', async (...args: Parameters<typeof workDir>) => {
    if (++calls === 3) { entered(); await held }
    return workDir(...args)
  })
  const created = await create(graph('left'))
  await started
  try {
    const claimed = await ctx.tasks.get(created.id)
    assert.equal(claimed.status, 'running')
    assert.equal(claimed.steps[1].status, 'awaiting_review')
    assert.equal(claimed.steps[2].status, 'pending')
    assert.equal(claimed.steps[2].invocationId, null)
    const receipt = await ctx.tasks.approve(created.id, 'left', command(claimed, 'left'))
    assert.equal(receipt.status, 'running')
  } finally { release() }
  await until(created.id, 'succeeded')
  assert.deepEqual(executions.map(item => item.stepId), ['source', 'left', 'right', 'join'])
})
