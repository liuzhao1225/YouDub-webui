import type { Context } from 'cordis'
import { AppError, type ProviderDescription, type OperationProvider } from '@youdub/sdk'

export interface PythonProviderConfig {
  descriptor: ProviderDescription; command: string; args: string[]; cwd: string;
  runtimeAdapter?: string; options?: Record<string, any>;
  $plugin?: { id: string; version: string; integrity: string }
}
export const name = 'python-provider'
export const inject = ['catalog', 'process', 'store']
export async function apply(ctx: Context, config: PythonProviderConfig) {
  const description = structuredClone(config.descriptor)
  if (config.$plugin) Object.assign(description, { pluginId: config.$plugin.id, pluginVersion: config.$plugin.version, integrity: config.$plugin.integrity })
  if (!description.id || !description.operations?.length || !config.command || !config.args?.length) throw new AppError('INVALID_PLUGIN', 'Python provider requires a description and execution entry.', 500)
  const provider: OperationProvider = {
    id: description.id,
    describe: () => structuredClone(description),
    probe: async () => {
      if (config.runtimeAdapter) {
        const runtime = await ctx.store.call('runtime.get')
        const capability = runtime.capabilities.find((item: any) => item.adapter === config.runtimeAdapter && item.capability === description.capability)
        if (!capability) throw new AppError('INVALID_PLUGIN', `Unknown official runtime adapter ${config.runtimeAdapter}.`, 500)
        Object.assign(description, { ...capability, id: description.id, label: description.label,
          available: capability.available, unavailableReason: capability.unavailable_reason,
          dataSent: capability.data_sent, remoteOperations: capability.remote_operations,
        })
      } else description.available = true
      return { available: description.available, reason: description.unavailableReason ?? null }
    },
    execute: (request, context) => ctx.process.worker({ command: config.command, args: config.args, cwd: config.cwd }, { ...request, binding: { ...request.binding, options: { ...config.options, ...request.binding.options } } }, context),
  }
  await provider.probe()
  ctx.effect(() => ctx.catalog.registerProvider(provider))
}
