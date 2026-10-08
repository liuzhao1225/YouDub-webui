import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { startHost } from '../../../apps/host/src/bootstrap.js'

test('an empty Cordis composition creates no product services or application data', async () => {
  const root = await mkdtemp(join(tmpdir(), 'youdub-empty-'))
  const host = await startHost([], pathToFileURL(root + '/').href)
  try {
    assert.equal(host.ctx.store, undefined)
    assert.equal(host.ctx.tasks, undefined)
    assert.equal(host.ctx.http, undefined)
    assert.deepEqual(await readdir(root), [])
  } finally { await host.stop(); await rm(root, { recursive: true }) }
})

test('selected missing dependencies and original initialization failures fail startup', async t => {
  const root = await mkdtemp(join(tmpdir(), 'youdub-bootstrap-'))
  t.after(() => rm(root, { recursive: true }))
  const pending = join(root, 'pending.mjs'), broken = join(root, 'broken.mjs')
  await writeFile(pending, "export const inject=['missing-service']; export function apply() {}")
  await writeFile(broken, "export function apply() {throw new Error('original initialization failure')}")
  await assert.rejects(startHost([{ id: 'pending', name: pathToFileURL(pending).href }], pathToFileURL(root + '/').href), /Plugin startup failed:.*pending/)
  await assert.rejects(startHost([{ id: 'broken', name: pathToFileURL(broken).href }], pathToFileURL(root + '/').href), (error: any) => error instanceof AggregateError && error.errors.some((cause: any) => cause.message.includes('original initialization failure')))
})

test('cleanup failure remains visible after Cordis disposal settles', async t => {
  const root = await mkdtemp(join(tmpdir(), 'youdub-cleanup-'))
  t.after(() => rm(root, { recursive: true }))
  const entry = join(root, 'cleanup.mjs')
  await writeFile(entry, "export function apply(ctx) {ctx.effect(()=>()=>{throw new Error('original cleanup failure')})}")
  const host = await startHost([{ id: 'cleanup', name: pathToFileURL(entry).href }], pathToFileURL(root + '/').href)
  await assert.rejects(host.stop(), (error: any) => error instanceof AggregateError && error.errors.some((cause: any) => cause.message.includes('original cleanup failure')))
})

test('the same consumer uses a replacement tasks service selected only by composition', async t => {
  const root = await mkdtemp(join(tmpdir(), 'youdub-replacement-'))
  t.after(() => rm(root, { recursive: true }))
  const consumer = join(root, 'consumer.mjs')
  await writeFile(consumer, "export const inject=['tasks']; export function apply(ctx){ctx.reflect.provide('taskView',{get:id=>ctx.tasks.get(id)})}")
  for (const implementation of ['first', 'replacement']) {
    const provider = join(root, implementation + '.mjs')
    await writeFile(provider, `export function apply(ctx){ctx.reflect.provide('tasks',{get:async id=>({id,sourceName:'${implementation}'})})}`)
    const host = await startHost([{ id: 'engine', name: pathToFileURL(provider).href }, { id: 'consumer', name: pathToFileURL(consumer).href }], pathToFileURL(root + '/').href)
    try { assert.equal((await (host.ctx as any).taskView.get('example')).sourceName, implementation) }
    finally { await host.stop() }
  }
})
