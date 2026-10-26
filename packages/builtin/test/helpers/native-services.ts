/** Domain tests use the product services; only profile storage and credentials are fixtures. */
import type { Context } from 'cordis'
import type { ProcessService } from '@youdub/sdk'

await import(new URL('../../../../apps/harness/test/source-framework.mjs', import.meta.url).href)
const source = new URL('../../../../.cache/harness/source-build/', import.meta.url)
const { Context: NativeContext } = await import(new URL('vendor/cordis/lib/index.js', source).href)
const { default: LocalSubprocess } = await import(new URL('packages/subprocess/subprocess-local/lib/index.js', source).href)
const { default: YouDubWorker } = await import(new URL('../../../../apps/harness/src/backend/worker.mjs', import.meta.url).href)
const { default: YouDubSettings } = await import(new URL('../../../../apps/harness/src/backend/settings.mjs', import.meta.url).href)

export async function Processes(ctx: Context) {
  const native = new NativeContext()
  ctx.effect(() => () => native.fiber.dispose())
  await native.plugin(LocalSubprocess)
  await native.plugin(YouDubWorker, { env: {} })
  const worker: ProcessService = native.youdubWorker
  const service: ProcessService = {
    run: request => worker.run(request),
    worker: (request, invocation, context) => worker.worker(request, invocation, context),
    rpc: request => worker.rpc(request),
  }
  ctx.reflect.provide('youdubWorker', service)
}

export const Settings = {
  inject: ['store', 'catalog'],
  async apply(ctx: Context) {
    const native = new NativeContext()
    ctx.effect(() => () => native.fiber.dispose())
    native.reflect.provide('store', ctx.store)
    native.reflect.provide('catalog', ctx.catalog)
    native.reflect.provide('credentials', {
      async describe() { throw new Error('This fixture has no credentials') },
      async resolve() { throw new Error('This fixture has no credentials') },
    })
    let preferences = { defaults: null, connections: [], ui_language: 'zh', plugins: {} }
    await native.plugin(YouDubSettings, {
      preferences: { get: () => preferences },
      forms: {
        describe: () => [{ ns: 'youdub-subtitles', revision: 0 }],
        async update(_ns: string, patch: { preferences: typeof preferences }) { preferences = patch.preferences },
      },
    })
    ctx.reflect.provide('settings', native.settings)
  },
}
