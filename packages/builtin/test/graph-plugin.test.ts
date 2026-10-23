import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context, type Fiber } from 'cordis'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import type { StepState } from '@youdub/sdk'
import Processes from '../src/process.js'
import Store from '../src/store.js'
import Files from '../src/files.js'
import Catalog from '../src/catalog.js'
import Secrets from '../src/secrets.js'
import Settings from '../src/settings.js'
import Tasks from '../src/tasks.js'
import Extensions from '../src/extensions.js'
import * as Graph from '../src/workflow-graph.js'
import { workflowTemplates } from '../src/workflow-templates.js'

test('installed external graph plugin pauses, validates corrections and exports the approved revision', async t => {
  const root = await mkdtemp(join(tmpdir(), 'youdub-graph-plugin-')), ctx = new Context(), fibers: Fiber[] = []
  t.after(async () => {
    try { await ctx.parallel('app/stopping') }
    finally { for (const fiber of [...fibers].reverse()) await fiber.dispose(); await rm(root, { recursive: true }) }
  })
  fibers.push(await ctx.plugin(Processes), await ctx.plugin(Catalog), await ctx.plugin(Files, { root }))
  fibers.push(await ctx.plugin(Store, { root, repoRoot: process.cwd(), python: process.env.YOUDUB_TEST_PYTHON || resolve('.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python') }))
  fibers.push(await ctx.plugin(Secrets), await ctx.plugin(Settings), await ctx.plugin(Tasks, { pollMs: 5 }), await ctx.plugin(Graph, { integrity: 'sha256:graph-plugin-test' }))
  const extensionConfig = { root: join(root, 'extensions'), repoRoot: process.cwd() }
  let extensions = await ctx.plugin(Extensions, extensionConfig)
  await ctx.extensions.install({ source: resolve('fixtures/plugins/graph-text-review') })
  assert.deepEqual(ctx.extensions.hostEntries(), [])
  await extensions.dispose()
  extensions = await ctx.plugin(Extensions, extensionConfig)
  fibers.push(extensions)
  const entry = ctx.extensions.hostEntries()[0]!
  fibers.push(await ctx.plugin(await import(entry.name), entry.config))
  ctx.extensions.markActive(entry.id)
  const client = ctx.extensions.clientManifest(true).modules.find(module => module.id === 'example.graph-text-review')!
  assert.ok(client)
  const asset = await ctx.extensions.asset(entry.id, '1.0.0', 'dist/client.js', true)
  assert.match(await readFile(asset.path, 'utf8'), /from '@youdub\/sdk\/client'/)
  const template = workflowTemplates(ctx.catalog, await ctx.settings.read()).find(item => item.id === 'example.text-review')!
  assert.equal(template.origin, 'plugin')
  const types = Graph.nodeTypes(ctx.catalog)
  assert.equal(types.length, 3)
  const reviewType = types.find(type => type.type === 'example.text-review')!
  assert.equal(reviewType.inputs.length, 2)
  assert.equal(reviewType.outputs.length, 2)
  assert.equal(reviewType.ui?.detailId, 'example.text-review.details')
  ctx.emit('app/ready')
  const id = randomUUID(), release = await ctx.files.reserve(id, true)
  try { await ctx.tasks.create({ id, workflowId: 'youdub.graph', config: {}, graphDocument: template.document, inputs: {} }) }
  finally { await release() }
  async function until(status: string) {
    for (let count = 0; count < 500; count++) {
      const task = await ctx.tasks.get(id)
      assert.notEqual(task.status, 'failed', JSON.stringify(task.error))
      if (task.status === status) return task
      await delay(10)
    }
    throw new Error(`Task did not reach ${status}.`)
  }
  const paused = await until('paused')
  assert.equal(paused.steps.find((step: StepState) => step.id === 'export')!.status, 'pending')
  assert.equal(paused.plan.bindings.review!.pluginId, 'example.graph-text-review')
  assert.notEqual(paused.plan.bindings.review!.integrity, 'fixture:development')
  const detail = await ctx.tasks.node(id, 'review')
  assert.deepEqual(detail.inputs, { left: { text: 'Hello YouDub' }, right: { text: '第二段待校对内容' } })
  const command = { expectedAttempt: detail.attempt, expectedTaskRevision: detail.taskRevision, expectedOutputRevision: detail.outputRevision }
  await assert.rejects(ctx.tasks.correct(id, 'review', { ...command, actionId: randomUUID(), patch: { text: { text: '   ' } } }), (error: any) => error.code === 'INVALID_CORRECTION')
  assert.equal((await ctx.tasks.node(id, 'review')).outputRevision, 1)
  await ctx.tasks.correct(id, 'review', { ...command, actionId: randomUUID(), patch: { text: { text: 'Reviewed by the external plugin' } }, continue: false })
  const corrected = await ctx.tasks.node(id, 'review')
  assert.equal(corrected.status, 'paused')
  assert.deepEqual(corrected.resultRevisions.map(result => result.source), ['computed', 'correction'])
  assert.deepEqual(corrected.resultRevisions[1]!.outputs.metadata, { sources: 2 })
  await ctx.tasks.approve(id, 'review', { actionId: randomUUID(), expectedAttempt: corrected.attempt, expectedTaskRevision: corrected.taskRevision, expectedOutputRevision: corrected.outputRevision })
  await until('succeeded')
  const task = await ctx.tasks.record(id), output = task.artifacts[task.outputs[0]!.artifact.id]!
  assert.equal(await readFile(await ctx.files.resolve(id, output), 'utf8'), 'Reviewed by the external plugin\n\n来源数量：2\n')
})
