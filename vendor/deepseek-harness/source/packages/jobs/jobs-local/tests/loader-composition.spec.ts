import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import LocalJobRegistry from '@deepseek-ai/dsh-jobs-local'
import type { JobHandle, JobOutcome } from '@deepseek-ai/dsh-jobs'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

describe('jobs-local through a real Loader composition', () => {
  it('accepts old output configuration and retains progress, cancellation and wait through a Cordis row', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-jobs-local-loader-'))
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      "- name: '@deepseek-ai/dsh-jobs-local'",
      '  config:',
      '    retainBytes: 8',
      '',
    ].join('\n'))

    context = new Context()
    context.baseUrl = pathToFileURL(root).href + '/'
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    context.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (specifier === '@deepseek-ai/dsh-jobs-local') return LocalJobRegistry
        throw new Error(`unexpected Loader import: ${specifier}`)
      },
    } as unknown as NonNullable<typeof context.loader.internal>
    await context.loader.create({
      name: 'cordis:include',
      config: { path: pathToFileURL(configPath).href },
    })
    await context.loader.await()

    expect(context.jobs).toBeInstanceOf(LocalJobRegistry)
    const registry = context.jobs
    const detach = registry.attachController('loader-test')
    let settle!: (outcome: JobOutcome) => void
    let handle!: JobHandle
    const reasons: (string | undefined)[] = []
    const id = registry.start({
      kind: 'bash',
      label: 'loader operation',
      run: (job) => {
        handle = job
        return {
          cancel: (reason) => { reasons.push(reason); settle({ status: 'killed' }) },
          done: new Promise((resolve) => { settle = resolve }),
        }
      },
    })
    handle.updateProgress('2/3')
    expect(registry.get(id)).toMatchObject({ status: 'running', progress: '2/3' })
    const waiting = registry.wait(id, 1000)
    expect(registry.kill(id, 'user cancelled')).toBe('requested')
    expect(registry.get(id).status).toBe('stopping')
    await expect(waiting).resolves.toMatchObject({ status: 'killed', detail: 'user cancelled' })
    expect(reasons).toEqual(['user cancelled'])
    registry.remove(id)
    expect(registry.list()).toEqual([])
    detach()
    expect(() => registry.start({
      kind: 'bash', label: 'no controller',
      run: () => { throw new Error('must not start') },
    })).toThrow('no job controller attached')
  })

  it('disposes controllers with their context and waits for live work on service teardown', async () => {
    context = new Context()
    const service = await context.plugin(LocalJobRegistry)
    const registry = context.jobs
    const controller = await context.plugin({
      inject: ['jobs'],
      apply(ctx: Context) {
        ctx.jobs.attachController('temporary-controller')
      },
    })
    let settle!: (outcome: JobOutcome) => void
    const reasons: (string | undefined)[] = []
    const id = registry.start({
      kind: 'bash', label: 'running on teardown',
      run: () => ({
        cancel: (reason) => { reasons.push(reason); settle({ status: 'killed' }) },
        done: new Promise(resolve => { settle = resolve }),
      }),
    })
    await controller.dispose()
    expect(registry.get(id).status).toBe('running')
    expect(() => registry.start({
      kind: 'bash', label: 'controller disposed',
      run: () => { throw new Error('must not start') },
    })).toThrow('no job controller attached')
    const waiting = registry.wait(id, 1000)
    await service.dispose()
    await expect(waiting).resolves.toMatchObject({ status: 'killed' })
    expect(reasons).toEqual(['jobs service disposed'])
    expect(registry.list()).toEqual([])
  })
})


describe('job lifecycle errors', () => {
  async function registry() {
    context = new Context()
    await context.plugin(LocalJobRegistry)
    context.jobs.attachController('test')
    return context.jobs
  }

  it('rejects retired output before invoking the producer and leaves throwing starters unregistered', async () => {
    const jobs = await registry()
    const spec = { kind: 'media', label: 'media', run() { throw new Error('starter failed') } }
    expect(() => jobs.start({ ...spec, output: [] } as typeof spec)).toThrow('output sources are no longer supported')
    expect(() => jobs.start(spec)).toThrow('starter failed')
    expect(jobs.list()).toEqual([])
  })

  it('propagates cancellation failure, preserves state, and isolates wait timeout and abort', async () => {
    const jobs = await registry()
    const done = Promise.withResolvers<JobOutcome>()
    const id = jobs.start({ kind: 'media', label: 'media', run: () => ({
      cancel() { throw new Error('cancel failed') }, done: done.promise,
    }) })
    expect(() => jobs.kill(id)).toThrow('cancel failed')
    expect(jobs.get(id).status).toBe('running')
    await expect(jobs.wait(id, 1)).resolves.toMatchObject({ status: 'running' })
    const abort = new AbortController()
    const waiting = jobs.wait(id, 1000, abort.signal)
    abort.abort()
    await expect(waiting).rejects.toThrow('wait aborted')
    expect(() => jobs.remove(id)).toThrow('still running')
    done.resolve({ status: 'completed' })
    await expect(jobs.wait(id, 1000)).resolves.toMatchObject({ status: 'completed' })
    await expect(jobs.wait(id, 1000, abort.signal)).resolves.toMatchObject({ status: 'completed' })
  })

  it('records producer rejection and force-fails a throwing teardown cancel before dropping records', async () => {
    const jobs = await registry()
    const id = jobs.start({ kind: 'media', label: 'failed', run: () => ({
      cancel() {}, done: Promise.reject(new Error('producer failed')),
    }) })
    await expect(jobs.wait(id, 1000)).resolves.toMatchObject({ status: 'failed', detail: 'Error: producer failed' })
    const late = Promise.withResolvers<JobOutcome>()
    const active = jobs.start({ kind: 'media', label: 'teardown', run: () => ({
      cancel() { throw new Error('cancel failed') }, done: late.promise,
    }) })
    const waiting = jobs.wait(active, 1000)
    await context!.fiber.dispose()
    await expect(waiting).resolves.toMatchObject({ status: 'failed', detail: expect.stringContaining('work may be orphaned') })
    late.resolve({ status: 'completed' })
    await late.promise
    expect(jobs.list()).toEqual([])
  })
})
