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
  it('accepts old output configuration and retains progress and settlement through a Cordis row', async () => {
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
    const id = registry.start({
      kind: 'bash',
      label: 'loader operation',
      run: (job) => {
        handle = job
        return {
          cancel: () => { settle({ status: 'killed' }) },
          done: new Promise((resolve) => { settle = resolve }),
        }
      },
    })
    handle.updateProgress('2/3')
    expect(registry.list()).toEqual([expect.objectContaining({ id, status: 'running', progress: '2/3' })])
    settle({ status: 'completed', detail: 'operation finished' })
    await expect.poll(() => registry.list()).toEqual([expect.objectContaining({ id, status: 'completed', detail: 'operation finished' })])
    expect(registry.list()[0]).not.toHaveProperty('progress')
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
        cancel: (reason) => { reasons.push(reason) },
        done: new Promise(resolve => { settle = resolve }),
      }),
    })
    await controller.dispose()
    expect(registry.list()).toEqual([expect.objectContaining({ id, status: 'running' })])
    expect(() => registry.start({
      kind: 'bash', label: 'controller disposed',
      run: () => { throw new Error('must not start') },
    })).toThrow('no job controller attached')
    let disposed = false
    const disposal = service.dispose().then(() => { disposed = true })
    await expect.poll(() => reasons).toEqual(['jobs service disposed'])
    expect(disposed).toBe(false)
    expect(registry.list()[0].status).toBe('stopping')
    settle({ status: 'killed' })
    await disposal
    expect(disposed).toBe(true)
    expect(reasons).toEqual(['jobs service disposed'])
    expect(registry.list()).toEqual([])
  })
})


describe('job lifecycle errors', () => {
  async function registry() {
    context = new Context()
    const service = await context.plugin(LocalJobRegistry)
    context.jobs.attachController('test')
    return { jobs: context.jobs, service }
  }

  it('rejects retired output before invoking the producer and leaves throwing starters unregistered', async () => {
    const { jobs } = await registry()
    const spec = { kind: 'media', label: 'media', run() { throw new Error('starter failed') } }
    expect(() => jobs.start({ ...spec, output: [] } as typeof spec)).toThrow('output sources are no longer supported')
    expect(() => jobs.start(spec)).toThrow('starter failed')
    expect(jobs.list()).toEqual([])
  })

  it('records producer rejection and force-fails a throwing teardown cancel before dropping records', async () => {
    const { jobs, service } = await registry()
    const warnings: string[] = []
    context!.logger.exporter({ levels: { default: 3 }, export(message) {
      if (message.type === 'warn') warnings.push(String(message.args[0]))
    } })
    const id = jobs.start({ kind: 'media', label: 'failed', run: () => ({
      cancel() {}, done: Promise.reject(new Error('producer failed')),
    }) })
    await expect.poll(() => jobs.list()).toEqual([expect.objectContaining({ id, status: 'failed', detail: 'Error: producer failed' })])
    const late = Promise.withResolvers<JobOutcome>()
    const active = jobs.start({ kind: 'media', label: 'teardown', run: () => ({
      cancel() { throw new Error('cancel failed') }, done: late.promise,
    }) })
    await service.dispose()
    expect(warnings).toContain(`jobs: cancel of ${active} threw during teardown; job record forced failed and work may be orphaned: Error: cancel failed`)
    late.resolve({ status: 'completed' })
    await late.promise
    expect(jobs.list()).toEqual([])
  })
})
