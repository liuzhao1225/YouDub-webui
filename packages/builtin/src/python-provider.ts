import { validateMediaCorrection } from './node-contracts.js'
import type { Context } from 'cordis'
import { AppError, type ProviderDescription, type OperationProvider } from '@youdub/sdk'

export interface PythonProviderConfig {
  descriptor: ProviderDescription; command: string; args: string[]; cwd: string;
  runtimeAdapter?: string; probeMediaTools?: boolean; dependencyGroups?: string[]; options?: Record<string, any>;
  corrections?: 'media' | 'schema';
  $plugin?: { id: string; version: string; integrity: string }
}
export const name = 'python-provider'
export const inject = ['catalog', 'youdubWorker']
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
        let capability
        try { capability = await store!.call('runtime.probe', { adapter: config.runtimeAdapter }) }
        catch (error) {
          description.available = false; description.unavailableReason = error instanceof Error ? error.message : String(error)
          return { available: false, reason: description.unavailableReason }
        }
        if (capability.adapter !== config.runtimeAdapter || capability.capability !== description.capability) throw new AppError('INVALID_PLUGIN', `Invalid runtime capability for ${config.runtimeAdapter}.`, 500)
        Object.assign(description, { ...capability, id: description.id, label: description.label,
          available: capability.available, unavailableReason: capability.unavailable_reason,
          dataSent: capability.data_sent, remoteOperations: capability.remote_operations,
        })
      } else if (config.dependencyGroups) {
        try {
          const result = await ctx.youdubWorker.run({ command: config.command, args: ['-m', 'backend.workers.setup_probe', 'resources', JSON.stringify(config.dependencyGroups)], cwd: config.cwd })
          const state = JSON.parse(result.stdout)
          if (!Array.isArray(state.missing) || typeof state.media !== 'boolean') throw new Error('Invalid resource probe result.')
          description.unavailableReason = state.missing.length ? `Missing dependencies: ${state.missing.join(', ')}` : !state.media ? state.mediaReason || 'Media tools are unavailable.' : !state.punkt ? 'Whisper sentence resources are unavailable.' : !state.demucsSource ? 'Demucs source is unavailable.' : null
          description.available = !description.unavailableReason
        } catch (error) {
          description.available = false
          description.unavailableReason = error instanceof Error ? error.message : String(error)
        }
      } else if (config.probeMediaTools) {
        try {
          for (const command of [process.env.FFMPEG_PATH?.trim() || 'ffmpeg', process.env.FFPROBE_PATH?.trim() || 'ffprobe']) {
            await ctx.youdubWorker.run({ command, args: ['-version'], cwd: config.cwd })
          }
          description.available = true
          description.unavailableReason = null
        } catch (error) {
          description.available = false
          description.unavailableReason = error instanceof Error ? error.message : String(error)
        }
      } else description.available = true
      return { available: description.available, reason: description.unavailableReason ?? null }
    },
    ...(config.corrections ? { validateCorrection: config.corrections === 'media' ? validateMediaCorrection :
      (({ baselineOutputs, patch }) => ({ ...structuredClone(baselineOutputs), ...structuredClone(patch) })) as NonNullable<OperationProvider['validateCorrection']> } : {}),
    execute: (request, context) => ctx.youdubWorker.worker({ command: config.command, args: config.args, cwd: config.cwd }, { ...request, binding: { ...request.binding, options: request.config.graph ? request.binding.options : { ...config.options, ...request.binding.options } } }, context),
  }
  await provider.probe()
  ctx.effect(() => ctx.catalog.registerProvider(provider))
}
