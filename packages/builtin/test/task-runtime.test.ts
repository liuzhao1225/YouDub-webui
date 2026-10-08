import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context, type Fiber } from 'cordis'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import type { InvocationContext, OperationProvider, WorkflowDefinition, TaskView, OutputPort } from '@youdub/sdk'
import Processes from '../src/process.js'
import Store from '../src/store.js'
import Files from '../src/files.js'
import Catalog from '../src/catalog.js'
import Secrets from '../src/secrets.js'
import Settings from '../src/settings.js'
import Tasks from '../src/tasks.js'

async function setup(t: any, contract: 'artifact' | 'json' | 'omitted' | 'downgraded' = 'artifact') {
  const root = await mkdtemp(join(tmpdir(), 'youdub-tasks-')), ctx = new Context()
  const fibers: Fiber[] = []
  fibers.push(await ctx.plugin(Processes), await ctx.plugin(Catalog), await ctx.plugin(Files, { root }))
  fibers.push(await ctx.plugin(Store, { root, repoRoot: process.cwd(), python: resolve('.venv/bin/python') }))
  fibers.push(await ctx.plugin(Secrets), await ctx.plugin(Settings), await ctx.plugin(Tasks, { pollMs: 10 }))
  t.after(async () => { await ctx.parallel('app/stopping'); for (const fiber of [...fibers].reverse()) await fiber.dispose(); await rm(root, { recursive: true }) })
  const identity = { pluginId: 'test.runtime', pluginVersion: '1.0.0', integrity: 'test-fixed' }
  const output: OutputPort = contract === 'json'
    ? { name: 'document', kind: 'json', schemaId: 'document/v1', required: true, schema: { type: 'object', required: ['text'], properties: { text: { type: 'string' } }, additionalProperties: false } }
    : { name: 'file', kind: 'artifact', schemaId: 'file/v1', required: true }
  let previous: InvocationContext | undefined
  const write = async (workDir: string, context: InvocationContext) => {
    await writeFile(join(workDir, 'result.txt'), 'real task output', { flag: 'wx' })
    return { state: 'completed' as const, outputs: { file: await context.register({ path: 'result.txt', mimeType: 'text/plain', schemaId: 'file/v1' }) } }
  }
  const provider: OperationProvider = {
    id: 'test.provider',
    describe: () => ({ id: 'test.provider', label: 'Test provider', ...identity, operations: [{ id: 'test/v1', inputSchema: { type: 'object' }, outputs: [output] }] }),
    probe: async () => ({ available: true }),
    async execute(request, context) {
      if (request.config.mode === 'wait') return { state: 'waiting', operation: { workDir: request.workDir }, nextPollAt: new Date(Date.now() + 300).toISOString() }
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
    describe: () => ({ id: 'test.workflow', version: '1.0.0', label: 'Test workflow', inputs: [], defaults: { mode: 'text' }, configSchema: { type: 'object', required: ['mode'], properties: { mode: { enum: ['text', 'wait', 'bad', 'cancel', 'bad-json', 'deleted', 'forged', 'unknown'] } }, additionalProperties: false } }),
    validate: () => [],
    plan: (_, config) => ({ workflow: { id: 'test.workflow', version: '1.0.0', ...identity }, config, bindings: { main: { providerId: provider.id, ...identity, modelRevision: null, options: {} } }, steps: [{ id: 'process', label: 'Process', bindingKey: 'main', operation: 'test/v1', input: {}, outputs: contract === 'omitted' ? [] : [{ ...output, required: contract !== 'downgraded' }] }], outputs: contract === 'json' || contract === 'omitted' ? [] : [{ id: 'file', label: 'File', role: 'file', source: { stepId: 'process', output: 'file' }, required: true }] }),
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
  return { ctx, create, until, previous: () => previous! }
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
