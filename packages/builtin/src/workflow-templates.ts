import { AppError, type CatalogService, type JsonObject, type WorkflowDocument } from '@youdub/sdk'
import { parseWorkflowDocument } from './workflow-document.js'
import subtitles from './workflow-templates/reviewed-subtitles.json' with { type: 'json' }
import dubbing from './workflow-templates/source-clone-dubbing.json' with { type: 'json' }

export function workflowTemplates(catalog: CatalogService, settings: JsonObject) {
  const build = (source: unknown, id: string, title: string): WorkflowDocument => {
    const document = structuredClone(source) as WorkflowDocument
    document.id = id; document.title = title
    for (const node of document.nodes) {
      if (node.type === 'youdub.translate' && node.provider.id === 'openai') {
        const selected = catalog.listProviders().find(provider => provider.capability === 'translation' && !provider.legacy && provider.available && provider.id.startsWith('llm.'))
        if (selected) node.provider = { id: selected.id, device: 'remote' }
      }
      const provider = catalog.listProviders().find(provider => provider.id === node.provider.id)
      if (node.provider.model) continue
      const connection = (settings.connections ?? []).find((item: JsonObject) => item.adapter === (provider?.adapter ?? provider?.id))
      const model = connection?.model ?? provider?.models?.find(item => item.available !== false)?.id
      if (model) node.provider = { ...node.provider, model, device: node.provider.device ?? provider?.models?.find(item => item.id === model)?.devices?.[0] ?? (provider?.execution === 'remote' ? 'remote' : undefined) }
    }
    return document
  }
  const plain = build(subtitles, 'youdub.subtitles', '字幕翻译')
  plain.nodes.forEach(node => { node.autoContinue = true })
  const review = build(subtitles, 'youdub.reviewed-subtitles', '字幕翻译 · 人工校对')
  const dub = build(dubbing, 'youdub.dubbing', '视频配音')
  const both = build(dubbing, 'youdub.subtitles-dubbing', '字幕＋配音')
  both.nodes.find(node => node.type === 'youdub.export')!.config.renderSubtitles = true
  both.outputs.push(...structuredClone(plain.outputs.filter(output => output.schemaId === 'application/x-subrip/v1')))
  const records: { id: string; revision: number; origin: 'builtin' | 'plugin'; document: WorkflowDocument }[] = [plain, review, dub, both].map(document => ({ id: document.id, revision: 0, origin: 'builtin', document }))
  for (const workflow of catalog.describe().workflows) {
    if (!workflow.graphTemplate) continue
    const document = parseWorkflowDocument(workflow.graphTemplate)
    if (records.some(record => record.id === document.id)) throw new AppError('DUPLICATE_TEMPLATE', `Duplicate workflow template: ${document.id}`, 422)
    records.push({ id: document.id, revision: 0, origin: 'plugin', document })
  }
  return records
}
