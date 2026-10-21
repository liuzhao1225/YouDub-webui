/** Host-side Worker lifecycle behavior. */

import { Worker } from 'node:worker_threads'
import { describe, expect, it } from 'vitest'
import { InspectorWorkerLifecycle } from '../src/host/bridge/lifecycle.ts'

describe('Inspector Worker lifecycle', () => {
  it('keeps the runtime error listener and treats an already-exited Worker as stopped', async () => {
    const worker = new Worker('setImmediate(() => { throw new Error("runtime crash") })', { eval: true })
    const lifecycle = new InspectorWorkerLifecycle(worker)
    const failed = new Promise<Error>((resolve) => { lifecycle.markRunning(resolve) })

    await expect(failed).resolves.toMatchObject({ message: 'runtime crash' })
    await expect(lifecycle.stop(100)).resolves.toBeUndefined()
    expect(lifecycle.exitCode).toBeTypeOf('number')
  })

  it('reads readiness and completes graceful shutdown through one persistent owner', async () => {
    const worker = new Worker([
      "const { parentPort } = require('node:worker_threads')",
      "parentPort.postMessage({ type: 'ready', host: '127.0.0.1', port: 9230, targetId: 'test-target' })",
      "parentPort.on('message', message => { if (message.type === 'shutdown') process.exit(0) })",
    ].join('\n'), { eval: true })
    const lifecycle = new InspectorWorkerLifecycle(worker)

    await expect(lifecycle.waitForReady(1_000)).resolves.toMatchObject({
      host: '127.0.0.1',
      port: 9_230,
      targetId: 'test-target',
    })
    lifecycle.markRunning(() => { throw new Error('graceful exit reported as unexpected') })
    await expect(lifecycle.stop(1_000)).resolves.toBeUndefined()
    expect(lifecycle.exitCode).toBe(0)
  })
})
