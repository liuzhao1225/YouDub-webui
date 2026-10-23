import { AppError, type JsonObject, type NodeDescriptor, type OperationProvider } from '@youdub/sdk'
import { isDeepStrictEqual } from 'node:util'

const object = (properties: JsonObject = {}, required: string[] = []) => ({ type: 'object', additionalProperties: false, properties, required })
const language = { type: 'string', minLength: 2, maxLength: 24 }
const languageOptions = [
  { value: 'auto', label: { default: 'Auto detect', translations: { zh: '自动识别', ja: '自動検出' } } },
  { value: 'en', label: 'English' }, { value: 'zh', label: '中文' }, { value: 'ja', label: '日本語' },
]
const source = { sourceLanguage: { ...language, 'x-options': languageOptions, 'x-optionsFrom': 'source_languages', 'x-short-title': { default: 'Source language', translations: { zh: '原文语言', ja: '元の言語' } } } }
const target = { targetLanguage: { ...language, 'x-options': languageOptions.filter((item) => item.value !== 'auto'), 'x-optionsFrom': 'target_languages', 'x-short-title': { default: 'Translation language', translations: { zh: '译文语言', ja: '翻訳先の言語' } } } }
const port = (id: string, label: string, schema: string | string[], kind: 'json' | 'artifact' = 'json', required = true) => ({ id, label, kind, acceptedSchemaIds: typeof schema === 'string' ? [schema] : schema, required })
const audio = (id: string, label: string, required = true) => port(id, label, 'audio/wav/v1', 'artifact', required)
const transcript = () => port('transcript', '原文', 'transcript/v1')
const translation = () => port('translation', '译文', 'translation/v1')
const media = () => port('mediaInfo', '媒体信息', 'media-info/v1')
const video = () => port('video', '视频', ['file/v1', 'video/mp4/v1'], 'artifact')
const make = (type: string, zh: string, en: string, ja: string, category: string, inputs: NodeDescriptor['inputs'], properties: JsonObject = {}, defaults: JsonObject = {}): NodeDescriptor => ({
  type: 'youdub.' + type, version: '1.0.0', label: { default: en, translations: { zh, ja } }, category, inputs, configSchema: object(properties), defaults,
  ui: { quickFields: Object.keys(properties).slice(0, 3) },
})
export const nodeDescriptors: Record<string, NodeDescriptor> = {
  download: { ...make('download', '下载视频', 'Download video', '動画をダウンロード', 'input', [], { proxyPort: { type: 'integer', minimum: 0, maximum: 65535 } }, { proxyPort: 0 }), ui: { quickFields: ['proxyPort'] }, runtimeInputSchema: object({ url: { type: 'string', minLength: 1, maxLength: 2048 } }, ['url']) },
  prepare: make('prepare', '准备媒体', 'Prepare media', 'メディアを準備', 'media', [video()]),
  separate: make('separate', '分离人声', 'Separate vocals', '音声を分離', 'audio', [audio('sourceAudio', '原始音频')]),
  recognize: { ...make('transcribe', '语音识别', 'Transcribe', '文字起こし', 'text', [audio('audio', '音频'), media()], { ...source, initialPrompt: { type: ['string', 'null'] } }, { sourceLanguage: 'auto', initialPrompt: null }), corrections: { outputPorts: ['transcript'], schemaIds: ['transcript/v1'] }, ui: { quickFields: ['sourceLanguage'], detailId: 'youdub.transcript' } },
  translate: { ...make('translate', '翻译', 'Translate', '翻訳', 'text', [transcript()], { ...source, ...target, maxCompletionTokens: { type: 'integer', minimum: 65535 } }, { sourceLanguage: 'auto', targetLanguage: 'zh', maxCompletionTokens: 65535 }), corrections: { outputPorts: ['translation'], schemaIds: ['translation/v1'] }, ui: { quickFields: ['targetLanguage'], detailId: 'youdub.translation' } },
  reference: make('reference', '准备参考音频', 'Voice reference', '参照音声', 'audio', [transcript(), audio('audio', '人声')]),
  synthesize: make('synthesize', '生成配音', 'Synthesize speech', '吹き替え生成', 'audio', [transcript(), translation(), port('references', '参考音频', 'voice-references/v1', 'json', false)], { ...target, voice: { oneOf: [object({ mode: { const: 'source_clone' } }, ['mode']), object({ mode: { const: 'preset' }, id: { type: 'string', minLength: 1 } }, ['mode', 'id'])] } }, { targetLanguage: 'zh', voice: { mode: 'source_clone' } }),
  mix: make('mix', '混音', 'Mix audio', 'ミックス', 'audio', [transcript(), port('speechAudio', '分段配音', 'speech-audio/v1'), media(), audio('background', '背景音', false)], { keepBackground: { type: 'boolean' } }, { keepBackground: false }),
  align: make('align', '字幕对齐', 'Align subtitles', '字幕の整列', 'text', [transcript(), translation(), port('dubbedTimeline', '配音时间轴', 'dubbed-timeline/v1'), port('adjustedSpeech', '调整后配音', 'speech-audio/v1')], target, { targetLanguage: 'zh' }),
  export: make('export', '导出视频', 'Export video', '動画を書き出し', 'output', [video(), media(), transcript(), translation(), audio('finalAudio', '合成音频', false), port('dubbedTimeline', '配音时间轴', 'dubbed-timeline/v1', 'json', false), port('wordAlignment', '词级时间轴', 'word-alignment/v1', 'json', false)], { ...source, ...target, renderSubtitles: { type: 'boolean' } }, { sourceLanguage: 'auto', targetLanguage: 'zh', renderSubtitles: true }),
  importSubtitles: make('importSubtitles', '导入字幕', 'Import subtitles', '字幕を読み込み', 'input', [port('sourceSubtitles', '原文字幕', ['file/v1', 'application/x-subrip/v1'], 'artifact'), port('translatedSubtitles', '译文字幕', ['file/v1', 'application/x-subrip/v1'], 'artifact')], { ...source, ...target }, { sourceLanguage: 'en', targetLanguage: 'zh' }),
}


nodeDescriptors.synthesize.ui = { quickFields: ['targetLanguage'], editorId: 'youdub.synthesize' }
nodeDescriptors.export.ui = { quickFields: ['targetLanguage'] }
for (const [operation, title] of Object.entries({ synthesize: ['Dubbing language', '配音语言', '吹き替えの言語'], align: ['Alignment language', '对齐语言', '整列の言語'], export: ['Export language', '导出语言', '書き出しの言語'] })) {
  const properties = nodeDescriptors[operation].configSchema.properties
  properties.targetLanguage = { ...properties.targetLanguage, 'x-short-title': { default: title[0], translations: { zh: title[1], ja: title[2] } } }
}

const portTitles: Record<string, [string, string, string]> = {
  video: ['视频', 'Video', '動画'], sourceAudio: ['原始音频', 'Source audio', '元の音声'], audio: ['音频', 'Audio', '音声'],
  vocals: ['人声', 'Vocals', 'ボーカル'], background: ['背景音', 'Background', '背景音'], mediaInfo: ['媒体信息', 'Media info', 'メディア情報'],
  transcript: ['原文', 'Transcript', '原文'], translation: ['译文', 'Translation', '翻訳'], raw: ['原始数据', 'Raw result', '元データ'],
  references: ['参考音频', 'Voice references', '参照音声'], speechAudio: ['分段配音', 'Speech segments', '分割音声'], finalAudio: ['合成音频', 'Mixed audio', '合成音声'],
  dubbedTimeline: ['配音时间轴', 'Dubbed timeline', '吹き替えタイムライン'], adjustedSpeech: ['调整后配音', 'Adjusted speech', '調整済み音声'],
  wordAlignment: ['词级时间轴', 'Word alignment', '単語の時刻'], sourceSubtitles: ['原文字幕', 'Source subtitles', '原文字幕'], translatedSubtitles: ['译文字幕', 'Translated subtitles', '翻訳字幕'],
}
export const outputPortLabels = Object.fromEntries(Object.entries(portTitles).map(([key, title]) => [key, { default: title[1], translations: { zh: title[0], ja: title[2] } }]))
for (const descriptor of Object.values(nodeDescriptors)) for (const input of descriptor.inputs) if (outputPortLabels[input.id]) input.label = outputPortLabels[input.id]

const fieldTitles: Record<string, [string, string, string]> = {
  sourceLanguage: ['原文语言', 'Source language', '元の言語'], targetLanguage: ['目标语言', 'Target language', '翻訳先の言語'],
  initialPrompt: ['识别提示词', 'Recognition prompt', '認識プロンプト'], maxCompletionTokens: ['最大输出 Token', 'Maximum output tokens', '最大出力トークン'],
  proxyPort: ['本机 HTTP 代理端口（0 为直连）', 'Local HTTP proxy port (0 for direct)', 'ローカル HTTP プロキシポート（0 は直接接続）'],
  voice: ['声音', 'Voice', '音声'], keepBackground: ['保留背景音', 'Keep background audio', '背景音を保持'],
  renderSubtitles: ['烧录字幕', 'Burn subtitles', '字幕を焼き込む'], url: ['视频链接', 'Video URL', '動画リンク'],
}
for (const descriptor of Object.values(nodeDescriptors)) for (const schema of [descriptor.configSchema, descriptor.runtimeInputSchema]) {
  for (const [field, property] of Object.entries(schema?.properties ?? {})) {
    const title = fieldTitles[field]
    if (title) Object.assign(property as JsonObject, { title: title[0], 'x-title': { default: title[1], translations: { zh: title[0], ja: title[2] } } })
  }
}

/** Semantic checks supplement the host's schema and ownership checks. Original diagnostics remain immutable. */
export const validateMediaCorrection: NonNullable<OperationProvider['validateCorrection']> = ({ operation, inputs, baselineOutputs, patch }) => {
  const fail = (message: string): never => { throw new AppError('INVALID_CORRECTION', message, 422) }
  const result = { ...structuredClone(baselineOutputs), ...structuredClone(patch) }
  if (operation === 'speech.transcribe/v1') {
    const before = baselineOutputs.transcript, after = result.transcript
    if (after.detected_language !== before.detected_language) fail('Detected language cannot be changed by a segment correction.')
    if (after.segments.length !== before.segments.length) fail('Segment additions and removals are not supported.')
    let lastEnd = 0
    for (let index = 0; index < after.segments.length; index++) {
      const original = before.segments[index], segment = after.segments[index]
      if (segment.id !== original.id) fail('Segment IDs and order must stay unchanged.')
      if (segment.start_ms < lastEnd || segment.start_ms >= segment.end_ms || segment.end_ms > inputs.mediaInfo.duration_ms) fail(`Invalid timing for segment ${segment.id}.`)
      if (segment.speaker_id !== original.speaker_id) fail('Speaker identity must stay unchanged.')
      if (segment.text !== original.text || segment.start_ms !== original.start_ms || segment.end_ms !== original.end_ms) segment.words = null
      else if (!isDeepStrictEqual(segment.words, original.words)) fail('Word timings cannot be edited separately.')
      lastEnd = segment.end_ms
    }
  } else if (operation === 'text.translate/v1') {
    const after = result.translation, before = baselineOutputs.translation
    if (after.source_language !== before.source_language || after.target_language !== before.target_language) fail('Translation languages must stay unchanged.')
    const expected = inputs.transcript.segments.map((segment: any) => segment.id)
    if (!isDeepStrictEqual(after.segments.map((segment: any) => segment.segment_id), expected)) fail('Translation must contain each source segment exactly once in source order.')
  } else fail('This operation does not support corrections.')
  return result
}
