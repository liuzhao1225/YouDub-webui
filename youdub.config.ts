import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { builtinIntegrities } from './packages/builtin/src/builtin-integrity.js'
import { builtinResources } from './packages/builtin/src/runtime-resources.js'
import { operations } from './packages/builtin/src/media-contracts.js'
import type { EntryOptions } from '@cordisjs/plugin-loader'
import { runtimePaths } from './apps/host/src/paths.js'

export default async function composition(): Promise<EntryOptions[]> {
  const { root, repoRoot, python } = runtimePaths()
  const { version } = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8'))
  const identities = await builtinIntegrities(repoRoot)
  const entry = (id: string, name: string, config?: any): EntryOptions => ({ id, name: '@youdub/builtin/' + name, config })
  const provider = (id: string, label: string, kinds: string[], capability?: string, execution: 'local' | 'remote' = 'local'): EntryOptions => ({ inject: capability ? ['store'] : [], ...entry('provider-' + id.replaceAll('.', '-'), 'python-provider', {
    command: python, args: ['-m', 'backend.workers.operation'], cwd: repoRoot, runtimeAdapter: capability ? id : undefined, corrections: 'media', dependencyGroups: capability ? undefined : ['base', ...(builtinResources(id)?.dependencyGroups ?? [])],
    descriptor: { id, label, pluginId: 'youdub.provider-' + id, pluginVersion: '1.0.0', ...identities[id], resources: builtinResources(id), operations: kinds.map(key => operations[key]), capability, adapter: capability ? id : undefined, execution, ...(id === 'openai' ? { legacy: true } : {}) },
  }) })
  const entries = [
    entry('catalog', 'catalog'), entry('media-output-validation', 'media-output-validation'), entry('files', 'files', { root }),
    entry('store', 'store', { root, repoRoot, python }), entry('secrets', 'secrets'), entry('settings', 'settings'), entry('models', 'llm-models'),
    provider('youdub.download', 'yt-dlp', ['download']),
    provider('youdub.media', 'FFmpeg / Media', ['prepare', 'reference', 'mix', 'export', 'importSubtitles']),
    provider('whisper', 'Whisper', ['recognize'], 'asr'), provider('openai', 'OpenAI compatible', ['translate'], 'translation', 'remote'),
    provider('voxcpm', 'VoxCPM', ['synthesize'], 'tts'), provider('demucs', 'Demucs', ['separate'], 'separation'),
    provider('qwen_forced_aligner', 'Qwen Forced Aligner', ['align'], 'subtitle_alignment'),
    entry('workflow-localize', 'workflow-localize', identities['youdub.localize']), entry('workflow-graph', 'workflow-graph', identities['youdub.graph']), entry('tasks', 'tasks'),
    entry('auth', 'auth'), entry('extensions', 'extensions', { root: join(root, 'extensions'), repoRoot, python, builtinClientManifest: join(repoRoot, 'apps/web/plugin-dist/manifest.json') }),
    entry('extensions-loader', 'extensions-loader'), entry('api', 'api', { version }), entry('models-api', 'llm-models-api'),
  ]
  return [
    entry('process', 'process'),
    entry('http', 'http', { host: process.env.YOUDUB_HOST || '127.0.0.1', port: Number(process.env.YOUDUB_PORT || 8000) }),
    ...(process.env.YOUDUB_WEB_ROOT ? [entry('web', 'web', { root: process.env.YOUDUB_WEB_ROOT })] : []),
    entry('setup', 'setup', { root, repoRoot, python, version, entries }),
  ]
}
