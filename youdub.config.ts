import { join } from 'node:path'
import { readFile, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { operations } from './packages/builtin/src/media-contracts.js'
import type { EntryOptions } from '@cordisjs/plugin-loader'
import { runtimePaths } from './apps/host/src/paths.js'

export default async function composition(): Promise<EntryOptions[]> {
  const { root, repoRoot, python } = runtimePaths()
  const hash = createHash('sha256')
  const scan = async (directory: string) => {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('.') || entry.name === '__pycache__') continue
      const filename = join(directory, entry.name)
      if (entry.isDirectory()) await scan(filename)
      else if (/\.(ts|py|sql)$/.test(filename)) { hash.update(filename.slice(repoRoot.length)); hash.update(await readFile(filename)) }
    }
  }
  for (const directory of ['packages/builtin/src', 'packages/sdk/src', 'backend/workers', 'backend/app']) await scan(join(repoRoot, directory))
  const integrity = 'sha256:' + hash.digest('hex')
  const entry = (id: string, name: string, config?: any): EntryOptions => ({ id, name: '@youdub/builtin/' + name, config })
  const provider = (id: string, label: string, kinds: string[], capability?: string, execution: 'local' | 'remote' = 'local'): EntryOptions => ({ inject: capability ? ['store'] : [], ...entry('provider-' + id.replaceAll('.', '-'), 'python-provider', {
    command: python, args: ['-m', 'backend.workers.operation'], cwd: repoRoot, runtimeAdapter: capability ? id : undefined,
    descriptor: { id, label, pluginId: 'youdub.provider-' + id, pluginVersion: '1.0.0', integrity, operations: kinds.map(key => operations[key]), capability, adapter: capability ? id : undefined, execution },
  }) })
  return [
    entry('process', 'process'), entry('catalog', 'catalog'), entry('files', 'files', { root }),
    entry('store', 'store', { root, repoRoot, python }), entry('secrets', 'secrets'), entry('settings', 'settings'),
    provider('youdub.media', 'FFmpeg / Media', ['prepare', 'reference', 'mix', 'export', 'importSubtitles']),
    provider('whisper', 'Whisper', ['recognize'], 'asr'), provider('openai', 'OpenAI compatible', ['translate'], 'translation', 'remote'),
    provider('voxcpm', 'VoxCPM', ['synthesize'], 'tts'), provider('demucs', 'Demucs', ['separate'], 'separation'),
    provider('qwen_forced_aligner', 'Qwen Forced Aligner', ['align'], 'subtitle_alignment'),
    entry('workflow-localize', 'workflow-localize', { integrity }), entry('tasks', 'tasks'),
    entry('http', 'http', { host: process.env.YOUDUB_HOST || '127.0.0.1', port: Number(process.env.YOUDUB_PORT || 8000) }),
    entry('auth', 'auth'), entry('extensions', 'extensions', { root: join(root, 'extensions'), repoRoot, builtinClientManifest: join(repoRoot, 'apps/web/plugin-dist/manifest.json') }),
    entry('extensions-loader', 'extensions-loader'), entry('api', 'api'),
  ]
}
