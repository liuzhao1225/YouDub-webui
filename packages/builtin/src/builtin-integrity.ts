import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { JsonObject } from '@youdub/sdk'
import { operations } from './media-contracts.js'
import compatibility from './builtin-compatibility.json' with { type: 'json' }

// Only reviewed execution dependencies belong here. HTTP, settings, installation,
// package UI and generated workflow templates do not execute a pinned task.
const worker = ['backend/workers/operation.py', 'backend/workers/operations.py', 'backend/workers/protocol.py',
  'backend/app/config.py', 'backend/app/paths.py', 'backend/app/runtime_security.py', 'backend/app/accelerators.py',
  'backend/app/v1/errors.py', 'backend/app/v1/steps.py', 'backend/app/v1/data_contracts.py',
  'backend/app/v1/segments.py', 'backend/app/v1/audio_segments.py', 'backend/app/v1/audio.py',
  'backend/requirements/base.txt', 'backend/requirements/media.txt']
const media = ['media.py']
const python = (...names: string[]) => names.map(name => 'backend/app/v1/' + name)
export const executionFiles: Record<string, string[]> = {
  'youdub.download': [...worker, 'backend/workers/download.py', 'packages/sdk/src/video-source.ts', 'backend/requirements/download.txt'],
  'youdub.media': [...worker, ...python(...media, 'mix.py', 'export.py', 'sentence_split.py', 'tts.py', 'tts_process.py'), 'backend/requirements/voxcpm.txt'],
  whisper: [...worker, ...python(...media, 'asr.py', 'asr_process.py'), 'backend/requirements/whisper.txt'],
  voxcpm: [...worker, ...python(...media, 'tts.py', 'tts_process.py'), 'backend/requirements/voxcpm.txt'],
  demucs: [...worker, ...python(...media, 'separate.py', 'separate_process.py'), 'backend/requirements/demucs.txt'],
  qwen_forced_aligner: [...worker, ...python(...media, 'export.py', 'sentence_split.py', 'forced_alignment.py', 'forced_alignment_process.py'), 'backend/requirements/qwen_forced_aligner.txt'],
  'youdub.localize': ['packages/builtin/src/workflow-localize.ts', 'packages/sdk/src/video-source.ts'],
  'youdub.graph': ['packages/builtin/src/workflow-graph.ts', 'packages/builtin/src/workflow-document.ts', 'packages/builtin/src/media-graph-validation.ts', 'packages/sdk/src/video-source.ts'],
}
const operationKeys: Record<string, string[]> = {
  'youdub.download': ['download'], 'youdub.media': ['prepare', 'reference', 'mix', 'export', 'importSubtitles'],
  whisper: ['recognize'], voxcpm: ['synthesize'], demucs: ['separate'], qwen_forced_aligner: ['align'],
}
function executionContract(value: any, fieldMap = false): any {
  if (Array.isArray(value)) return value.map(item => executionContract(item))
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value).sort().filter(key => fieldMap || !['label', 'title', 'description', 'category', 'ui'].includes(key) && !key.startsWith('x-')).map(key => [key, executionContract(value[key], ['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas'].includes(key))]))
}
export function reviewedIntegrities(id: string, integrity: string, records = compatibility as Record<string, { integrity: string; previous: string[] }>) {
  const record = records[id]
  // A later source change invalidates this approval until explicitly reviewed.
  return record?.integrity === integrity ? [...record.previous] : []
}
export async function builtinIntegrities(root: string, read: (path: string) => Promise<Uint8Array> = path => readFile(path)) {
  const loaded = new Map<string, Promise<Uint8Array>>()
  const contents = (name: string) => { if (!loaded.has(name)) loaded.set(name, read(join(root, name))); return loaded.get(name)! }
  const results: Record<string, { integrity: string; compatibleIntegrities: string[] }> = {}
  for (const [id, files] of Object.entries(executionFiles)) {
    const hash = createHash('sha256')
    const contract: JsonObject[] = (operationKeys[id] ?? Object.keys(operations)).map(key => executionContract(operations[key]))
    hash.update(JSON.stringify(contract))
    for (const path of [...files, 'packages/builtin/src/media-output-validation.ts'].sort()) {
      hash.update(path); hash.update(await contents(path))
    }
    const integrity = 'sha256:' + hash.digest('hex')
    results[id] = { integrity, compatibleIntegrities: reviewedIntegrities(id, integrity) }
  }
  return results
}
