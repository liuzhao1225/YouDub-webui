import type { Artifact, TaskRecord } from '@youdub/sdk'

const coverNames = new Set(['cover', 'thumbnail', 'poster'])
const isImage = (artifact: Artifact | undefined) => artifact?.mimeType.startsWith('image/')

// Cover selection is independent of a workflow's implementation and never
// substitutes a different file after an advertised cover fails to load.
export function taskCover(task: TaskRecord): Artifact | undefined {
  for (const output of task.outputs ?? []) {
    const artifact = task.artifacts[output.artifact.id]
    if ((coverNames.has(output.role) || coverNames.has(output.id)) && isImage(artifact)) return artifact
  }
  const inputs = Object.entries(task.inputs ?? {}).map(([slot, ref]) => ({ slot, artifact: task.artifacts[ref.id] }))
  for (const { slot, artifact } of inputs) if (coverNames.has(slot) && isImage(artifact)) return artifact
  for (const { slot, artifact } of inputs) {
    if (artifact?.mimeType.startsWith('video/')) return artifact
    // The v1 read-only adapter preserves the original filename but uses an
    // octet-stream MIME type for its video input.
    if (task.legacy && slot === 'video' && artifact?.mimeType === 'application/octet-stream' && /\.(mp4|m4v|mov|mkv|webm|avi|mpeg|mpg|ts|mts|m2ts|flv|wmv)$/i.test(artifact.name)) return artifact
  }
  for (const output of task.outputs ?? []) {
    const artifact = task.artifacts[output.artifact.id]
    if (artifact?.mimeType.startsWith('video/')) return artifact
  }
}
