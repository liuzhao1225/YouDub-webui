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
  // Current node outputs are available before the workflow publishes its final
  // outputs. Historical artifacts remain registered after correction or retry.
  const nodeOutputs = (task.steps ?? []).flatMap(step => {
    const spec = task.plan?.steps.find(item => item.id === step.id)
    return (spec?.outputs ?? []).filter(port => port.kind === 'artifact').map(port => ({
      artifact: task.artifacts[step.outputs[port.name]?.id],
      cover: coverNames.has(port.name) || task.plan.outputs.some(output =>
        output.source.stepId === step.id && output.source.output === port.name
        && (coverNames.has(output.role) || coverNames.has(output.id))),
    }))
  })
  for (const { cover, artifact } of nodeOutputs) if (cover && isImage(artifact)) return artifact
  for (const { slot, artifact } of inputs) {
    if (artifact?.mimeType.startsWith('video/')) return artifact
    // The v1 read-only adapter preserves the original filename but uses an
    // octet-stream MIME type for its video input.
    if (task.legacy && slot === 'video' && artifact?.mimeType === 'application/octet-stream' && /\.(mp4|m4v|mov|mkv|webm|avi|mpeg|mpg|ts|mts|m2ts|flv|wmv)$/i.test(artifact.name)) return artifact
  }
  for (const { artifact } of nodeOutputs) if (artifact?.mimeType.startsWith('video/')) return artifact
  for (const output of task.outputs ?? []) {
    const artifact = task.artifacts[output.artifact.id]
    if (artifact?.mimeType.startsWith('video/')) return artifact
  }
}
