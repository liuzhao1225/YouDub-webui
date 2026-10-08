import { Context, Logger, type Fiber } from 'cordis'
import Loader, { type EntryOptions } from '@cordisjs/plugin-loader'
import { writeFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import '@youdub/sdk'

export async function startHost(entries: EntryOptions[], baseUrl: string, options: { ready?: boolean } = {}) {
  const ctx = new Context()
  ctx.baseUrl = baseUrl
  const failures: unknown[] = []
  const exportLog = ctx.logger.exporter({ export(message) {
    if (message.type === 'error') failures.push(...message.args)
    process.stderr.write(Logger.format({ colors: false, export() {} }, message) + '\n')
  } })
  const directory = await mkdtemp(join(tmpdir(), 'youdub-composition-'))
  const configuration = join(directory, 'plugins.json')
  await writeFile(configuration, JSON.stringify(entries, null, 2), { mode: 0o600 })
  let application: Fiber | undefined
  try {
    application = await ctx.plugin(async function application(context: Context) {
      await context.plugin(Loader, { baseUrl })
      await context.inject(['loader'], async scope => {
        await scope.loader.create({ name: '@cordisjs/plugin-include', config: { path: configuration } })
        await scope.loader.await()
      })
    })
    await ctx.loader.await()
    const unavailable: string[] = []
    for (const entry of ctx.loader.entries()) if (!entry.disabled && (!entry.fiber || entry.fiber.state !== 2)) unavailable.push(entry.options.id + ':' + entry.options.name)
    // Audit selected entries. Cordis itself registers optional inject fibers
    // (for example Include's HMR integration) that legitimately stay PENDING.
    if (application.state !== 2) unavailable.push('application')
    if (failures.length || unavailable.length) throw new AggregateError(failures, `Plugin startup failed: ${unavailable.join(', ')}`)
    if (options.ready !== false) ctx.emit('app/ready')
  } catch (error) {
    await application?.dispose()
    await exportLog(); await rm(directory, { recursive: true })
    throw error
  }
  let stopping: Promise<void> | undefined
  return {
    ctx,
    stop: () => stopping ??= (async () => {
      const before = failures.length
      const shutdown: unknown[] = []
      try { await ctx.parallel('app/stopping') } catch (error) { shutdown.push(error) }
      await application!.dispose()
      shutdown.push(...failures.slice(before))
      await exportLog(); await rm(directory, { recursive: true })
      if (shutdown.length) throw new AggregateError(shutdown, 'Plugin shutdown failed.')
    })(),
  }
}
