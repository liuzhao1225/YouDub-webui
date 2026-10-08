import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export const name = 'example-file-transform'
export const inject = ['catalog']

export function apply(ctx, config = {}) {
  const owner = config.$plugin || { id: 'example.file-transform', version: '1.0.0', integrity: 'fixture:development' }
  const identity = { pluginId: owner.id, pluginVersion: owner.version, integrity: owner.integrity }
  const providerId = 'example.text-transform'
  const operation = 'example.uppercase/v1'
  const outputs = [{ name: 'document', kind: 'artifact', schemaId: 'file/v1', required: true }]
  const provider = {
    id: providerId,
    describe: () => ({ id: providerId, label: 'UTF-8 大写转换', ...identity, available: true, operations: [{ id: operation, inputSchema: { type: 'object', required: ['document'], properties: { document: { type: 'object' } } }, outputs }] }),
    probe: async () => ({ available: true }),
    async execute(request, invocation) {
      invocation.signal.throwIfAborted()
      const source = await readFile(await invocation.resolve(request.inputs.document), 'utf8')
      await invocation.progress(0.5, '转换文本')
      invocation.signal.throwIfAborted()
      await writeFile(join(request.workDir, 'uppercase.txt'), source.toUpperCase(), { flag: 'wx', mode: 0o600 })
      const document = await invocation.register({ path: 'uppercase.txt', mimeType: 'text/plain', schemaId: 'file/v1' })
      return { state: 'completed', outputs: { document } }
    },
  }
  const workflow = {
    id: 'example.uppercase', version: '1.0.0', ...identity,
    describe: () => ({ id: 'example.uppercase', version: '1.0.0', label: '文本转大写', inputs: [{ name: 'document', label: '文本文件', required: true, acceptedMimeTypes: ['text/plain'], maxBytes: 2 * 1024 * 1024 }], configSchema: { type: 'object', properties: {}, additionalProperties: false }, defaults: {} }),
    validate: input => input.document ? [] : [{ code: 'INPUT_MISSING', message: '请选择文本文件。', field: 'document' }],
    plan(input, options) {
      return {
        workflow: { id: this.id, version: this.version, ...identity }, config: options,
        bindings: { transform: { ...identity, providerId, modelRevision: null, options: {} } },
        steps: [{ id: 'uppercase', label: '转换文本', bindingKey: 'transform', operation, input: { document: { from: 'task', name: 'document' } }, outputs }],
        outputs: [{ id: 'text', label: '大写文本', source: { stepId: 'uppercase', output: 'document' }, role: 'text', required: true }],
      }
    },
  }
  ctx.effect(() => ctx.catalog.registerProvider(provider))
  ctx.effect(() => ctx.catalog.registerWorkflow(workflow))
}
