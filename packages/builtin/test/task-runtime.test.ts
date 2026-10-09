import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context, type Fiber } from 'cordis'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { AppError, type InvocationContext, type OperationProvider, type WorkflowDefinition, type TaskView, type OutputPort } from '@youdub/sdk'
import Processes from '../src/process.js'
import Store from '../src/store.js'
import Files from '../src/files.js'
import Catalog from '../src/catalog.js'
import Secrets from '../src/secrets.js'
import Settings from '../src/settings.js'
import Tasks from '../src/tasks.js'

async function setup(t: any, contract: 'artifact' | 'json' | 'omitted' | 'downgraded' = 'artifact', expectedShutdownFailure?: RegExp, stepIds = ['process']) {
  const root = await mkdtemp(join(tmpdir(), 'youdub-tasks-')), ctx = new Context()
  const fibers: Fiber[] = []
  fibers.push(await ctx.plugin(Processes), await ctx.plugin(Catalog), await ctx.plugin(Files, { root }))
  fibers.push(await ctx.plugin(Store, { root, repoRoot: process.cwd(), python: resolve('.venv/bin/python') }))
  fibers.push(await ctx.plugin(Secrets), await ctx.plugin(Settings), await ctx.plugin(Tasks, { pollMs: 10 }))
  t.after(async () => {
    try { await ctx.parallel('app/stopping') }
    catch (error: any) {
      if (!expectedShutdownFailure) throw error
      const errors: Error[] = error instanceof AggregateError ? error.errors : [error]
      assert.ok(errors.some(item => expectedShutdownFailure.test(item.message)), 'Shutdown must preserve the original queue failure')
    }
    finally { for (const fiber of [...fibers].reverse()) await fiber.dispose(); await rm(root, { recursive: true }) }
  })
  const identity = { pluginId: 'test.runtime', pluginVersion: '1.0.0', integrity: 'test-fixed' }
  const output: OutputPort = contract === 'json'
    ? { name: 'document', kind: 'json', schemaId: 'document/v1', required: true, schema: { type: 'object', required: ['text'], properties: { text: { type: 'string' } }, additionalProperties: false } }
    : { name: 'file', kind: 'artifact', schemaId: 'file/v1', required: true }
  const nested: OutputPort = { name: 'nested', kind: 'json', schemaId: 'nested/v1', required: true, schema: { type: 'object', required: ['files'], additionalProperties: false, properties: { files: { type: 'array', items: { type: 'object', required: ['id', 'schemaId'], additionalProperties: false, properties: { id: { type: 'string' }, schemaId: { const: 'file/v1' } } } } } } }
  const ports = stepIds.length > 1 ? [output, nested] : [output]
  const executed: { taskId: string; stepId: string }[] = []
  let previous: InvocationContext | undefined
  const write = async (workDir: string, context: InvocationContext) => {
    await writeFile(join(workDir, 'result.txt'), 'real task output', { flag: 'wx' })
    const file = await context.register({ path: 'result.txt', mimeType: 'text/plain', schemaId: 'file/v1' })
    return { state: 'completed' as const, outputs: { file, ...(stepIds.length > 1 ? { nested: { files: [file] } } : {}) } }
  }
  const provider: OperationProvider = {
    id: 'test.provider',
    describe: () => ({ id: 'test.provider', label: 'Test provider', ...identity, operations: [{ id: 'test/v1', inputSchema: { type: 'object' }, outputs: ports }] }),
    probe: async () => ({ available: true }),
    async execute(request, context) {
      executed.push({ taskId: request.taskId, stepId: request.stepId })
      if (request.inputs.previous) {
        assert.deepEqual(request.inputs.previous, request.inputs.nested.files[0])
        assert.equal(await readFile(await context.resolve(request.inputs.previous), 'utf8'), 'real task output')
      }
      if (request.config.mode === 'wait' || request.config.mode === 'wait-offset') {
        const nextPollAt = request.config.mode === 'wait-offset'
          ? new Date(Date.now() + 300 + 8 * 60 * 60 * 1000).toISOString().replace('Z', '+08:00')
          : new Date(Date.now() + 300).toISOString()
        return { state: 'waiting', operation: { workDir: request.workDir }, nextPollAt }
      }
      if (request.config.mode === 'bad') return { state: 'completed', outputs: {} }
      if (request.config.mode === 'unknown') {
        await context.externalPrepare({ externalRequestId: 'remote-1', requestKey: request.invocationId })
        throw new Error('Remote response disconnected after acceptance')
      }
      if (request.config.mode === 'bad-json') return { state: 'completed', outputs: { document: { text: 42 } } }
      if (request.config.mode === 'deleted' || request.config.mode === 'forged') {
        await writeFile(join(request.workDir, 'result.txt'), 'registered before return')
        const artifact = await context.register({ path: 'result.txt', mimeType: 'text/plain', schemaId: request.config.mode === 'forged' ? 'other/v1' : 'file/v1' })
        if (request.config.mode === 'deleted') await rm(join(request.workDir, 'result.txt'))
        return { state: 'completed', outputs: { file: { ...artifact, schemaId: 'file/v1' } } }
      }
      if (request.config.mode === 'cancel' && request.attempt === 1) {
        previous = context
        return ctx.process.worker({ command: process.execPath, args: ['-e', `process.stdin.once('data',raw=>{const m=JSON.parse(raw);process.stdout.write(JSON.stringify({version:m.version,invocationId:m.invocationId,seq:1,type:'progress',payload:{value:0.1,message:'child running'}})+'\\n');setInterval(()=>{},1000);});`] }, request, context)
      }
      return write(request.workDir, context)
    },
    async poll(operation, context) { return write(operation.workDir, context) },
  }
  const workflow: WorkflowDefinition = {
    id: 'test.workflow', version: '1.0.0', ...identity,
    describe: () => ({ id: 'test.workflow', version: '1.0.0', label: 'Test workflow', inputs: [], defaults: { mode: 'text' }, configSchema: { type: 'object', required: ['mode'], properties: { mode: { enum: ['text', 'wait', 'wait-offset', 'bad', 'cancel', 'bad-json', 'deleted', 'forged', 'unknown'] } }, additionalProperties: false } }),
    validate: () => [],
    plan: (_, config) => ({ workflow: { id: 'test.workflow', version: '1.0.0', ...identity }, config, bindings: { main: { providerId: provider.id, ...identity, modelRevision: null, options: {} } }, steps: stepIds.map((id, index) => ({ id, label: id, bindingKey: 'main', operation: 'test/v1', input: index ? { previous: { from: 'step', stepId: stepIds[index - 1], output: 'file' }, nested: { from: 'step', stepId: stepIds[index - 1], output: 'nested' } } : {}, outputs: contract === 'omitted' ? [] : ports.map(port => ({ ...port, required: contract !== 'downgraded' })) })), outputs: contract === 'json' || contract === 'omitted' ? [] : [{ id: 'file', label: 'File', role: 'file', source: { stepId: stepIds.at(-1)!, output: 'file' }, required: true }] }),
  }
  fibers.push(await ctx.plugin({ inject: ['catalog'], apply(context) { context.effect(() => context.catalog.registerProvider(provider)); context.effect(() => context.catalog.registerWorkflow(workflow)) } }))
  const create = async (mode: string) => {
    const id = randomUUID(), release = await ctx.files.reserve(id, true)
    try { return await ctx.tasks.create({ id, workflowId: workflow.id, config: { mode }, inputs: {} }) }
    finally { await release() }
  }
  const until = async (id: string, predicate: (task: TaskView) => boolean) => {
    const deadline = Date.now() + 5000
    while (Date.now() < deadline) { const task = await ctx.tasks.get(id); if (predicate(task)) return task; await delay(10) }
    throw new Error(`Task did not reach expected state: ${JSON.stringify(await ctx.tasks.get(id))}`)
  }
  ctx.emit('app/ready')
  return { ctx, create, until, previous: () => previous!, executed, workflow, identity }
}

test('real SQLite task engine keeps the execution slot during waiting and resumes the fixed invocation', async t => {
  const { ctx, create, until } = await setup(t)
  const first = await create('wait')
  await until(first.id, task => task.status === 'waiting')
  const waiting = await ctx.tasks.record(first.id)
  const second = await create('text')
  await delay(50)
  assert.equal((await ctx.tasks.get(second.id)).status, 'queued')
  await until(first.id, task => task.status === 'succeeded')
  assert.equal((await ctx.tasks.record(first.id)).steps[0]?.invocationId, waiting.steps[0]?.invocationId)
  const completed = await until(second.id, task => task.status === 'succeeded')
  assert.deepEqual(completed.outputs, [{ id: 'file', label: 'File', role: 'file', name: 'result.txt', mimeType: 'text/plain', size: 16 }])
})

test('real task cancellation, explicit retry, and stale progress/CAS cannot overwrite the new attempt', async t => {
  const { ctx, create, until, previous } = await setup(t)
  const task = await create('cancel')
  await until(task.id, state => state.message === 'child running')
  const stale = await ctx.tasks.record(task.id)
  await ctx.tasks.cancel(task.id, 1)
  await until(task.id, state => state.status === 'cancelled')
  await ctx.tasks.retry(task.id, 1)
  const finished = await until(task.id, state => state.status === 'succeeded')
  assert.equal(finished.attempt, 2)
  await assert.rejects(previous().progress(0.9, 'late progress'))
  await assert.rejects(ctx.store.call('store.cas', { id: task.id, expectedRevision: stale.revision, task: { ...stale, message: 'late overwrite' } }), (error: any) => error.code === 'REVISION_CONFLICT')
  assert.equal((await ctx.tasks.get(task.id)).status, 'succeeded')
})

test('remote polling timestamps with timezone offsets use the same UTC queue clock', async t => {
  const { ctx, create, until } = await setup(t)
  const task = await create('wait-offset')
  const waiting = await until(task.id, state => state.status === 'waiting')
  assert.match(waiting.nextPollAt!, /Z$/)
  await until(task.id, state => state.status === 'succeeded')
  ctx.tasks.assertReady()
})

test('queue failure becomes visible to readiness and prevents accepting new tasks', async t => {
  const { ctx, create } = await setup(t, 'artifact', /Queue storage disconnected/)
  const call = ctx.store.call.bind(ctx.store)
  t.mock.method(ctx.store, 'call', (method: string, params: any) => {
    if (method === 'store.claim') throw new AppError('STORE_UNAVAILABLE', 'Queue storage disconnected', 503)
    return call(method, params)
  })
  const deadline = Date.now() + 2000
  while (true) {
    try { ctx.tasks.assertReady() }
    catch (error: any) { assert.equal(error.code, 'TASK_RUNTIME_UNAVAILABLE'); break }
    assert.ok(Date.now() < deadline, 'Task runtime continued to report readiness after its loop stopped')
    await delay(10)
  }
  await assert.rejects(create('text'), (error: any) => error.code === 'TASK_RUNTIME_UNAVAILABLE')
})

test('a provider success envelope without its required artifact fails the real task', async t => {
  const { ctx, create, until } = await setup(t)
  const task = await create('bad')
  const failed = await until(task.id, state => state.status === 'failed')
  assert.equal(failed.error?.code, 'STAGE_OUTPUT_MISSING')
  assert.equal((await ctx.tasks.record(task.id)).outputs.length, 0)
})

test('invalid JSON and forged or deleted artifacts never complete a real task', async t => {
  for (const mode of ['bad-json', 'forged', 'deleted']) await t.test(mode, async t => {
    const { ctx, create, until } = await setup(t, mode === 'bad-json' ? 'json' : 'artifact')
    const task = await create(mode)
    const failed = await until(task.id, state => state.status === 'failed')
    assert.ok(failed.error)
    if (mode !== 'deleted') assert.equal(failed.error.code, 'INVALID_PROVIDER_RESULT')
    assert.equal((await ctx.tasks.record(task.id)).outputs.length, 0)
  })
})

test('workflow plans cannot omit or downgrade required provider outputs', async t => {
  for (const contract of ['omitted', 'downgraded'] as const) await t.test(contract, async t => {
    const { create } = await setup(t, contract)
    await assert.rejects(create('text'), (error: any) => error.code === 'INVALID_PLAN')
  })
})

test('cancelling a waiting task also finishes its waiting step', async t => {
  const { ctx, create, until } = await setup(t)
  const task = await create('wait')
  await until(task.id, state => state.status === 'waiting')
  await ctx.tasks.cancel(task.id, 1)
  const cancelled = await until(task.id, state => state.status === 'cancelled')
  assert.equal(cancelled.steps[0].status, 'cancelled')
  assert.ok(cancelled.steps[0].finishedAt)
  assert.equal(cancelled.nextPollAt, null)
})

test('an unknown remote result remains visible and prevents retry or unacknowledged rerun', async t => {
  const { ctx, create, until } = await setup(t)
  const task = await create('unknown')
  const failed = await until(task.id, state => state.status === 'failed')
  assert.equal(failed.mayStillRun, true)
  assert.equal(failed.externalRequests['remote-1'].state, 'unknown')
  await assert.rejects(ctx.tasks.retry(task.id, 1), (error: any) => error.code === 'EXTERNAL_RESULT_UNKNOWN')
  await assert.rejects(ctx.tasks.rerun(task.id, { id: randomUUID(), config: { mode: 'text' } }), (error: any) => error.code === 'EXTERNAL_RESULT_UNKNOWN')
  const second = await ctx.tasks.rerun(task.id, { id: randomUUID(), config: { mode: 'text' }, acknowledgeExternalRisk: true })
  await until(second.id, state => state.status === 'succeeded')
  assert.equal((await ctx.tasks.get(task.id)).mayStillRun, true)
})

test('partial rerun creates an independent task and reuses completed artifacts before queueing', async t => {
  const { ctx, create, until, executed, identity, workflow } = await setup(t, 'artifact', undefined, ['prepare', 'reference', 'synthesize', 'export'])
  const first = await create('text')
  await until(first.id, task => task.status === 'succeeded')
  const original = await ctx.tasks.record(first.id)
  identity.integrity = 'updated-runtime'; workflow.integrity = identity.integrity
  const rerun: TaskView = await ctx.tasks.rerun(first.id, { id: randomUUID(), config: original.config, fromStep: 'reference' })
  assert.deepEqual(rerun.steps.map((step: { status: string }) => step.status), ['completed', 'pending', 'pending', 'pending'])
  assert.equal(rerun.reusedFrom?.taskId, first.id)
  assert.equal(rerun.reusedFrom?.attempt, 1)
  assert.equal(rerun.reusedFrom?.workflow.integrity, 'test-fixed')
  assert.equal(rerun.plan.workflow.integrity, 'updated-runtime')
  const cloned = await ctx.tasks.record(rerun.id)
  const file = cloned.steps[0].outputs.file
  assert.notEqual(file.id, original.steps[0].outputs.file.id)
  assert.deepEqual(cloned.steps[0].outputs.nested.files[0], file)
  assert.equal(Object.keys(cloned.artifacts).length, 1, 'copy only referenced prefix artifacts and deduplicate nested references')
  assert.deepEqual(await ctx.tasks.record(first.id), original, 'the original successful record remains unchanged')
  const completed = await until(rerun.id, task => task.status === 'succeeded')
  assert.deepEqual(executed.filter(item => item.taskId === rerun.id).map(item => item.stepId), ['reference', 'synthesize', 'export'])
  await ctx.tasks.delete(first.id, 1)
  assert.equal(await readFile(await ctx.files.resolve(rerun.id, (await ctx.tasks.record(rerun.id)).artifacts[file.id]), 'utf8'), 'real task output')
  assert.equal(completed.outputs.length, 1)
})

test('partial rerun rejects missing boundaries, changed configuration and changed prefix contracts', async t => {
  const { ctx, create, until, workflow } = await setup(t, 'artifact', undefined, ['prepare', 'synthesize'])
  const task = await create('text')
  await until(task.id, state => state.status === 'succeeded')
  await assert.rejects(ctx.tasks.rerun(task.id, { id: randomUUID(), config: { mode: 'bad' }, fromStep: 'synthesize' }), (error: any) => error.code === 'REUSE_NOT_ALLOWED')
  await assert.rejects(ctx.tasks.rerun(task.id, { id: randomUUID(), config: { mode: 'text' }, fromStep: 'missing' }), (error: any) => error.code === 'REUSE_NOT_ALLOWED')
  const plan = workflow.plan.bind(workflow)
  t.mock.method(workflow, 'plan', async (...args: Parameters<typeof plan>) => {
    const result = await plan(...args)
    result.steps[0].input = { changed: true }
    return result
  })
  await assert.rejects(ctx.tasks.rerun(task.id, { id: randomUUID(), config: { mode: 'text' }, fromStep: 'synthesize' }), (error: any) => error.code === 'REUSE_NOT_ALLOWED')
  assert.equal((await ctx.tasks.get(task.id)).status, 'succeeded')
})

test('partial rerun rejects incomplete prefixes and corrupted reusable artifacts without creating a task', async t => {
  const { ctx, create, until } = await setup(t, 'artifact', undefined, ['prepare', 'synthesize'])
  const failed = await create('bad')
  await until(failed.id, state => state.status === 'failed')
  await assert.rejects(ctx.tasks.rerun(failed.id, { id: randomUUID(), config: { mode: 'bad' }, fromStep: 'synthesize' }), (error: any) => error.code === 'REUSE_NOT_ALLOWED')
  const task = await create('text')
  await until(task.id, state => state.status === 'succeeded')
  const source = await ctx.tasks.record(task.id), reused = source.artifacts[source.steps[0].outputs.file.id]
  await writeFile(await ctx.files.resolve(task.id, reused), 'modified content of another size')
  const id = randomUUID()
  await assert.rejects(ctx.tasks.rerun(task.id, { id, config: { mode: 'text' }, fromStep: 'synthesize' }), (error: any) => error.code === 'OUTPUT_NOT_FOUND')
  await assert.rejects(ctx.tasks.record(id), (error: any) => error.code === 'TASK_NOT_FOUND')
})
