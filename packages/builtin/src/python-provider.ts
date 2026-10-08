import type { Context } from 'cordis'
import { AppError, type ProviderDescription, type OperationProvider } from '@youdub/sdk'

export interface PythonProviderConfig {
  descriptor: ProviderDescription; command: string; args: string[]; cwd: string;
  runtimeAdapter?: string; options?: Record<string, any>;
  $plugin?: { id: string; version: string; integrity: string }
}
export const name = 'python-provider'
export const inject = ['catalog', 'process']
export async function apply(ctx: Context, config: PythonProviderConfig) {
  const description = structuredClone(config.descriptor)
  if (config.$plugin) Object.assign(description, { pluginId: config.$plugin.id, pluginVersion: config.$plugin.version, integrity: config.$plugin.integrity })
  if (!description.id || !description.operations?.length || !config.command || !config.args?.length) throw new AppError('INVALID_PLUGIN', 'Python provider requires a description and execution entry.', 500)
  // Loader entries using official runtime probes declare inject: ['store'].
  // Cordis rejects missing/undeclared dependencies and owns their lifecycle.
  const store = config.runtimeAdapter ? ctx.store : undefined
  const provider: OperationProvider = {
    id: description.id,
    describe: () => structuredClone(description),
    probe: async () => {
      if (config.runtimeAdapter) {
        const capability = await store!.call('runtime.probe', { adapter: config.runtimeAdapter })
        if (capability.adapter !== config.runtimeAdapter || capability.capability !== description.capability) throw new AppError('INVALID_PLUGIN', `Invalid runtime capability for ${config.runtimeAdapter}.`, 500)
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
