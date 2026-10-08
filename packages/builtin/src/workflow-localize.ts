import type { Context } from 'cordis'
import { type WorkflowDefinition, type JsonObject, type Diagnostic, type CatalogService, type WorkflowPlan, type ExactProviderBinding } from '@youdub/sdk'
import { operations } from './media-contracts.js'

export const name = 'workflow-localize'
export const inject = ['catalog', 'settings']
const labels: Record<string, string> = { prepare: '准备媒体', separate: '分离人声', recognize: '语音识别', translate: '翻译', reference: '准备参考音频', synthesize: '生成配音', mix: '混音', align: '字幕对齐', export: '导出' }
const selection = (extra: JsonObject = {}) => ({ type: 'object', required: ['adapter', 'model', 'device'], additionalProperties: false,
  properties: { adapter: { type: 'string', minLength: 1 }, model: { type: 'string', minLength: 1 }, device: { type: 'string', minLength: 1 }, ...extra } })
const nullable = (schema: JsonObject) => ({ anyOf: [schema, { type: 'null' }] })
export const localizeSchema: JsonObject = {
  type: 'object', additionalProperties: false,
  required: ['source_language', 'target_language', 'output_mode', 'keep_background', 'asr', 'translation', 'tts', 'separation'],
  properties: {
    source_language: { type: 'string', minLength: 2 }, target_language: { type: 'string', minLength: 2 },
    output_mode: { enum: ['subtitles', 'dubbing', 'both'] }, keep_background: { type: 'boolean' },
    asr: selection({ initial_prompt: { type: ['string', 'null'], maxLength: 500 } }), translation: selection(),
    tts: nullable(selection({ voice: { oneOf: [
      { type: 'object', additionalProperties: false, required: ['mode'], properties: { mode: { const: 'source_clone' } } },
      { type: 'object', additionalProperties: false, required: ['mode', 'id'], properties: { mode: { const: 'preset' }, id: { type: 'string', minLength: 1 } } },
    ] } })),
    separation: nullable(selection()), subtitle_alignment: nullable(selection()),
  },
}
export async function apply(ctx: Context, plugin: { integrity: string; version?: string }) {
  const version = plugin.version ?? '1.0.0', pluginId = 'youdub.workflow-localize'
  let settings = await ctx.settings.read()
  ctx.on('settings/updated', updated => { settings = updated })
  const first = (capability: string) => {
    const provider = ctx.catalog.describe().providers.find(item => item.capability === capability && item.available)
    const model = provider?.models?.[0]
    return provider && model ? { adapter: provider.adapter ?? provider.id, model: model.id, device: model.devices[0] } : null
  }
  const defaults = () => settings.defaults ?? { source_language: 'auto', target_language: 'zh', output_mode: 'subtitles', keep_background: false, asr: first('asr'), translation: first('translation'), tts: null, separation: null, subtitle_alignment: null }
  const pick = (kind: string, config: JsonObject, catalog: CatalogService) => catalog.describe().providers.find(item => item.capability === kind && (item.adapter ?? item.id) === config[kind]?.adapter)
  const workflow: WorkflowDefinition = {
    id: 'youdub.localize', version, pluginId, pluginVersion: version, integrity: plugin.integrity,
    describe: () => ({ id: 'youdub.localize', version, label: '视频翻译与配音', inputs: [{ name: 'video', label: '视频', required: true, acceptedMimeTypes: ['video/*'], maxBytes: Number(process.env.LOCAL_UPLOAD_MAX_BYTES ?? 4294967296) }], configSchema: localizeSchema, defaults: structuredClone(defaults()), ui: { editor: 'youdub.localize' } }),
    validate: async (_, config, catalog) => {
      const errors: Diagnostic[] = []
      const fail = (message: string, field?: string) => errors.push({ code: 'INVALID_CONFIG', message, field })
      if (config.source_language.toLowerCase() === config.target_language.toLowerCase() || config.target_language === 'auto') fail('Source and target languages must differ.', 'target_language')
      if (config.output_mode === 'subtitles' && (config.tts || config.separation || config.keep_background)) fail('Subtitles mode requires no TTS, separation, or background mix.')
      if (config.output_mode !== 'subtitles' && (!config.tts || !config.tts.voice)) fail('Dubbing requires a TTS provider and voice.')
      if (config.subtitle_alignment && config.output_mode !== 'both') fail('Subtitle alignment requires both mode.')
      const needsSeparation = config.keep_background || config.tts?.voice?.mode === 'source_clone'
      if (needsSeparation !== Boolean(config.separation)) fail('Separation must match the background and voice requirements.', 'separation')
      const connections = (await ctx.settings.read()).connections
      for (const kind of ['asr', 'translation', 'tts', 'separation', 'subtitle_alignment']) {
        const selection = config[kind]; if (!selection) continue
        const provider = pick(kind, config, catalog)
        if (!provider?.available) { fail(provider?.unavailableReason || `Provider ${selection.adapter} is unavailable.`, `${kind}.adapter`); continue }
        const model = provider.models?.find(item => item.id === selection.model)
        if (!model || !model.devices.includes(selection.device)) { fail('Selected model or device is unavailable.', `${kind}.model`); continue }
        if (['asr', 'translation'].includes(kind) && config.source_language !== 'auto' && !model.source_languages.includes(config.source_language)) fail('Source language is unsupported.', 'source_language')
        if (['translation', 'tts', 'subtitle_alignment'].includes(kind) && !model.target_languages.includes(config.target_language)) fail('Target language is unsupported.', 'target_language')
        if (kind === 'tts') {
          if (!model.voice_modes.includes(selection.voice.mode)) fail('Selected voice mode is unsupported.', 'tts.voice')
          if (selection.voice.mode === 'preset' && !model.voices?.some((voice: any) => voice.id === selection.voice.id && voice.languages.includes(config.target_language))) fail('Selected preset voice is unavailable.', 'tts.voice.id')
        }
        if (provider.execution === 'remote' && !connections.some((connection: any) => connection.adapter === selection.adapter && connection.base_url && connection.has_api_key)) fail('Provider connection is not configured.', `${kind}.adapter`)
      }
      return errors
    },
    plan: (_, config, catalog) => {
      const plan: WorkflowPlan = { workflow: { id: workflow.id, version, pluginId, pluginVersion: version, integrity: plugin.integrity }, config: structuredClone(config), bindings: {}, steps: [], outputs: [], omittedSteps: [] }
      const binding = (key: string, providerId: string, selection: JsonObject = {}) => {
        const provider = catalog.provider(providerId).describe()
        const options = { ...config, sourceLanguage: config.source_language, targetLanguage: config.target_language, outputMode: config.output_mode, keepBackground: config.keep_background, voice: config.tts?.voice, initialPrompt: config.asr?.initial_prompt, maxCompletionTokens: 65535 }
        plan.bindings[key] = { pluginId: provider.pluginId, pluginVersion: provider.pluginVersion, integrity: provider.integrity, providerId, contractVersion: '1', model: selection.model, modelRevision: null, device: selection.device, options: JSON.parse(JSON.stringify(options)) } satisfies ExactProviderBinding
      }
      binding('media', 'youdub.media')
      for (const kind of ['asr', 'translation', 'tts', 'separation', 'subtitle_alignment']) if (config[kind]) binding(kind, pick(kind, config, catalog)!.id, config[kind])
      const task = (name: string) => ({ from: 'task' as const, name })
      const step = (stepId: string, output: string) => ({ from: 'step' as const, stepId, output })
      const add = (id: string, bindingKey: string, input: JsonObject) => { const operation = operations[id]; plan.steps.push({ id, label: labels[id], bindingKey, operation: operation.id, input, outputs: structuredClone(operation.outputs) }) }
      add('prepare', 'media', { video: task('video') })
      if (config.separation) add('separate', 'separation', { sourceAudio: step('prepare', 'sourceAudio') })
      add('recognize', 'asr', { audio: config.separation ? step('separate', 'vocals') : step('prepare', 'sourceAudio'), mediaInfo: step('prepare', 'mediaInfo') })
      add('translate', 'translation', { transcript: step('recognize', 'transcript') })
      if (config.tts) {
        if (config.tts.voice.mode === 'source_clone') add('reference', 'media', { transcript: step('recognize', 'transcript'), audio: step('separate', 'vocals') })
        else plan.omittedSteps!.push({ id: 'reference', reason: 'Preset voice does not require source references.' })
        add('synthesize', 'tts', { transcript: step('recognize', 'transcript'), translation: step('translate', 'translation'), ...(config.tts.voice.mode === 'source_clone' ? { references: step('reference', 'references') } : {}) })
        add('mix', 'media', { transcript: step('recognize', 'transcript'), speechAudio: step('synthesize', 'speechAudio'), mediaInfo: step('prepare', 'mediaInfo'), ...(config.keep_background ? { background: step('separate', 'background') } : {}) })
        if (config.subtitle_alignment) add('align', 'subtitle_alignment', { transcript: step('recognize', 'transcript'), translation: step('translate', 'translation'), dubbedTimeline: step('mix', 'dubbedTimeline'), adjustedSpeech: step('mix', 'adjustedSpeech') })
        else plan.omittedSteps!.push({ id: 'align', reason: 'Model subtitle alignment is disabled.' })
      }
      add('export', 'media', { video: task('video'), mediaInfo: step('prepare', 'mediaInfo'), transcript: step('recognize', 'transcript'), translation: step('translate', 'translation'), ...(config.tts ? { finalAudio: step('mix', 'finalAudio'), dubbedTimeline: step('mix', 'dubbedTimeline') } : {}), ...(config.subtitle_alignment ? { wordAlignment: step('align', 'wordAlignment') } : {}) })
      const final = (id: string, output: string, label: string) => plan.outputs.push({ id, label, role: id, source: { stepId: 'export', output }, required: true })
      final('video', 'video', '视频')
      if (config.output_mode !== 'subtitles') final('audio', 'audio', '配音音频')
      if (config.output_mode !== 'dubbing') { final('source_subtitles', 'sourceSubtitles', '原文字幕'); final('translated_subtitles', 'translatedSubtitles', '译文字幕') }
      return plan
    },
  }
  ctx.effect(() => ctx.catalog.registerWorkflow(workflow))
}
