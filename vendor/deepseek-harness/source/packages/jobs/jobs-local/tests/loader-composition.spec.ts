import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import LocalJobRegistry from '@deepseek-ai/dsh-jobs-local'
import type { JobEvent, JobHandle, JobOutcome } from '@deepseek-ai/dsh-jobs'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

describe('jobs-local through a real Loader composition', () => {
  it('retains configured output, progress, cancellation and wait through a Cordis row', async () => {
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
    const events: JobEvent[] = []
    registry.events.subscribe(event => { events.push(event) })
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
    handle.append('1234567890')
    handle.updateProgress('2/3')
    expect(registry.get(id)).toMatchObject({ status: 'running', progress: '2/3' })
    expect(registry.readAt(id, 0)).toMatchObject({ lossy: true, chunks: [{ text: '34567890' }] })
    const waiting = registry.wait(id, 1000)
    expect(registry.kill(id, 'user cancelled')).toBe('requested')
    expect(registry.get(id).status).toBe('stopping')
    await expect(waiting).resolves.toMatchObject({ status: 'killed', detail: 'user cancelled' })
    expect(reasons).toEqual(['user cancelled'])
    expect(events.find(event => event.type === 'settled')).toMatchObject({ cause: 'kill', awaited: true })
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
    const service = await context.plugin(LocalJobRegistry, {})
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
