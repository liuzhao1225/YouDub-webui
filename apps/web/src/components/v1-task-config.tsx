"use client"

import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import type { Capability, ModelCapability, ModelSelection, Runtime, Settings, TaskConfig, TtsSelection } from "@/lib/v1-api"
import { OUTPUT_LABELS, selectClass, useV1Text, type V1Text } from "@/lib/v1-ui"

type Kind = Capability["capability"]
type Choice = { value: ModelSelection; model: ModelCapability }

function choices(runtime: Runtime, kind: Kind): Choice[] {
  return runtime.capabilities.filter((item) => item.capability === kind && item.available).flatMap((item) => (
    item.models.flatMap((model) => model.devices.filter((device) => (
      item.execution === "remote" ? device === "remote" : runtime.devices.some((entry) => entry.id === device && entry.available)
    )).map((device) => ({ value: { adapter: item.adapter, model: model.id, device: device as ModelSelection["device"] }, model })))
  ))
}

function selectionKey(value: ModelSelection | null) {
  return value ? JSON.stringify([value.adapter, value.model, value.device]) : ""
}

function firstSelection(runtime: Runtime, kind: Kind): ModelSelection {
  return choices(runtime, kind)[0]?.value ?? { adapter: "", model: "", device: "cpu" }
}

function selectedModel(runtime: Runtime, kind: Kind, value: ModelSelection | null) {
  return choices(runtime, kind).find((item) => selectionKey(item.value) === selectionKey(value))?.model
}

function prefersSourceClone(value: ModelSelection, model: ModelCapability | undefined) {
  return value.adapter === "voxcpm" && value.model === "VoxCPM2" && model?.voice_modes.includes("source_clone")
}

function selectTts(runtime: Runtime, value: ModelSelection, target: string): TtsSelection {
  const model = selectedModel(runtime, "tts", value)
  return { ...value, voice: !prefersSourceClone(value, model) && model?.voice_modes.includes("preset")
    ? { mode: "preset", id: model.voices.find((item) => item.languages.includes(target))?.id ?? "" }
    : { mode: "source_clone" } }
}

function firstTts(runtime: Runtime, target: string): TtsSelection {
  const preferred = choices(runtime, "tts").find((item) => prefersSourceClone(item.value, item.model) && item.model.target_languages.includes(target))
  return selectTts(runtime, preferred?.value ?? firstSelection(runtime, "tts"), target)
}

function normalize(config: TaskConfig, runtime: Runtime): TaskConfig {
  if (config.output_mode === "subtitles") return { ...config, keep_background: false, tts: null, separation: null }
  const tts = config.tts ?? firstTts(runtime, config.target_language)
  const needsSeparation = config.keep_background || tts.voice.mode === "source_clone"
  return { ...config, tts, separation: needsSeparation ? config.separation ?? firstSelection(runtime, "separation") : null }
}

export function initialTaskConfig(runtime: Runtime, settings: Settings): TaskConfig {
  if (settings.defaults) return settings.defaults
  const asr = firstSelection(runtime, "asr")
  const translation = firstSelection(runtime, "translation")
  const asrModel = selectedModel(runtime, "asr", asr)
  const translationModel = selectedModel(runtime, "translation", translation)
  const sources = asrModel?.source_languages.filter((item) => item === "auto" || translationModel?.source_languages.includes(item)) ?? []
  const source = sources.includes("en") ? "en" : sources[0] ?? ""
  const targets = translationModel?.target_languages.filter((item) => item !== source) ?? []
  return {
    source_language: source, target_language: targets.includes("zh") ? "zh" : targets[0] ?? "",
    output_mode: "subtitles", keep_background: false, asr, translation, tts: null, separation: null,
  }
}

export function configProblem(config: TaskConfig, runtime: Runtime, settings: Settings, text: V1Text): string | null {
  for (const kind of ["asr", "translation", "tts", "separation"] as const) {
    const selection = config[kind]
    if (!selection) continue
    const capability = runtime.capabilities.find((item) => item.adapter === selection.adapter && item.capability === kind)
    const model = selectedModel(runtime, kind, selection)
    if (!capability?.available || !model) return text("Select an available model for every required step.", "请为每个必需步骤选择可用模型。", "必要な各処理に利用可能なモデルを選択してください。")
    if (capability.execution === "remote") {
      const connection = settings.connections.find((item) => item.adapter === selection.adapter)
      if (!connection || (capability.requires_api_key && !connection.has_api_key)) return `${selection.adapter}: ${text("Configure its connection in Settings.", "请在设置中配置连接。", "設定で接続を登録してください。")}`
    }
  }
  const asr = selectedModel(runtime, "asr", config.asr)
  const translation = selectedModel(runtime, "translation", config.translation)
  const tts = selectedModel(runtime, "tts", config.tts)
  if (!asr?.source_languages.includes(config.source_language)
    || (config.source_language !== "auto" && !translation?.source_languages.includes(config.source_language))
    || !translation?.target_languages.includes(config.target_language)
    || config.source_language === config.target_language
    || (config.tts && !tts?.target_languages.includes(config.target_language))) {
    return text("Choose different supported source and target languages.", "请选择模型支持且不同的原文与目标语言。", "モデルが対応する異なる入力言語と出力言語を選択してください。")
  }
  if (config.tts) {
    const voice = config.tts.voice
    if (!tts?.voice_modes.includes(voice.mode) || (voice.mode === "preset" && !tts.voices.some((item) => item.id === voice.id && item.languages.includes(config.target_language)))) {
      return text("Select a supported voice.", "请选择可用声音。", "利用可能な声を選択してください。")
    }
  }
  return null
}

function ModelField({ kind, label, value, runtime, onChange }: {
  kind: Kind; label: string; value: ModelSelection | null; runtime: Runtime; onChange: (value: ModelSelection) => void
}) {
  const text = useV1Text()
  const options = choices(runtime, kind)
  const selected = selectionKey(value)
  return <div className="space-y-1.5">
    <Label htmlFor={`model-${kind}`}>{label}</Label>
    <select id={`model-${kind}`} className={selectClass} value={selected} onChange={(event) => {
      const next = options.find((item) => selectionKey(item.value) === event.target.value)
      if (next) onChange(next.value)
    }}>
      {!options.some((item) => selectionKey(item.value) === selected) && <option value={selected} disabled>
        {value?.model || text("Select a model", "选择模型", "モデルを選択")}
      </option>}
      {options.map((item) => <option key={selectionKey(item.value)} value={selectionKey(item.value)}>
        {item.value.adapter} / {item.value.model} · {item.value.device}
      </option>)}
      {runtime.capabilities.filter((item) => item.capability === kind && !item.available).map((item) => (
        <option key={item.adapter} value={`unavailable-${item.adapter}`} disabled>{item.adapter} — {item.unavailable_reason}</option>
      ))}
    </select>
  </div>
}

function LanguageField({ id, label, value, options, onChange }: {
  id: string; label: string; value: string; options: string[]; onChange: (value: string) => void
}) {
  const text = useV1Text()
  const names: Record<string, string> = { en: "English", zh: "中文", ja: "日本語", auto: text("Auto detect", "自动识别", "自動検出") }
  return <div className="space-y-1.5"><Label htmlFor={id}>{label}</Label>
    <select id={id} className={selectClass} value={value} onChange={(event) => onChange(event.target.value)}>
      {!options.includes(value) && <option value={value} disabled>{value || text("Select a language", "选择语言", "言語を選択")}</option>}
      {options.map((item) => <option key={item} value={item}>{names[item] ?? item}</option>)}
    </select>
  </div>
}

export function TaskConfigForm({ value, runtime, onChange }: {
  value: TaskConfig; runtime: Runtime; onChange: (value: TaskConfig) => void
}) {
  const text = useV1Text()
  const asr = selectedModel(runtime, "asr", value.asr)
  const translation = selectedModel(runtime, "translation", value.translation)
  const tts = selectedModel(runtime, "tts", value.tts)
  const sources = asr?.source_languages.filter((item) => item === "auto" || translation?.source_languages.includes(item)) ?? []
  const targets = translation?.target_languages.filter((item) => item !== value.source_language && (!value.tts || tts?.target_languages.includes(item))) ?? []
  const change = (patch: Partial<TaskConfig>) => onChange(normalize({ ...value, ...patch }, runtime))
  return <div className="space-y-5">
    <div className="space-y-1.5"><Label htmlFor="output-mode">{text("Output", "输出内容", "出力内容")}</Label>
      <select id="output-mode" className={selectClass} value={value.output_mode} onChange={(event) => change({ output_mode: event.target.value as TaskConfig["output_mode"] })}>
        {Object.entries(OUTPUT_LABELS).map(([mode, label]) => <option key={mode} value={mode}>{text(...label)}</option>)}
      </select>
    </div>
    <div className="grid gap-4 sm:grid-cols-2">
      <ModelField kind="asr" label={text("Speech recognition", "语音识别模型", "音声認識モデル")} value={value.asr} runtime={runtime} onChange={(asr) => change({ asr: { ...value.asr, ...asr } })} />
      <ModelField kind="translation" label={text("Translation", "翻译模型", "翻訳モデル")} value={value.translation} runtime={runtime} onChange={(translation) => change({ translation })} />
      <LanguageField id="source-language" label={text("Source language", "原文语言", "入力言語")} value={value.source_language} options={sources} onChange={(source_language) => change({ source_language })} />
      <LanguageField id="target-language" label={text("Target language", "目标语言", "出力言語")} value={value.target_language} options={targets} onChange={(target_language) => change({ target_language })} />
    </div>
    <div className="space-y-1.5">
      <Label htmlFor="asr-initial-prompt">{text("Proper-name hint (optional)", "专名提示（可选）", "固有名詞のヒント（任意）")}</Label>
      <Input id="asr-initial-prompt" maxLength={500} value={value.asr.initial_prompt ?? ""} aria-describedby="asr-initial-prompt-help"
        onChange={(event) => change({ asr: { ...value.asr, initial_prompt: event.target.value || null } })} />
      <p id="asr-initial-prompt-help" className="text-xs text-muted-foreground">{text("Add people or brand names to help speech recognition. Up to 500 characters.", "填写人名、品牌名，帮助语音识别。最多 500 字。", "人名やブランド名を入力すると音声認識の参考になります。500文字まで。")}</p>
    </div>
    {value.output_mode !== "subtitles" && <div className="space-y-4 border-t pt-4">
      <ModelField kind="tts" label={text("Voice model", "配音模型", "音声合成モデル")} value={value.tts} runtime={runtime} onChange={(selection) => change({ tts: selectTts(runtime, selection, value.target_language) })} />
      {value.tts && <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5"><Label htmlFor="voice-mode">{text("Voice source", "声音方式", "声の選択方法")}</Label>
          <select id="voice-mode" className={selectClass} value={value.tts.voice.mode} onChange={(event) => change({ tts: { ...value.tts!, voice: event.target.value === "source_clone"
            ? { mode: "source_clone" } : { mode: "preset", id: tts?.voices.find((voice) => voice.languages.includes(value.target_language))?.id ?? "" } } })}>
            {!tts?.voice_modes.includes(value.tts.voice.mode) && <option value={value.tts.voice.mode} disabled>{text("Unavailable", "不可用", "利用不可")}</option>}
            {tts?.voice_modes.map((mode) => <option key={mode} value={mode}>{mode === "preset" ? text("Preset voice", "预设声音", "プリセット音声") : text("Clone source voice", "克隆源音色", "元の声を複製")}</option>)}
          </select>
        </div>
        {value.tts.voice.mode === "preset" && <div className="space-y-1.5"><Label htmlFor="voice-id">{text("Voice", "声音", "音声")}</Label>
          <select id="voice-id" className={selectClass} value={value.tts.voice.id} onChange={(event) => change({ tts: { ...value.tts!, voice: { mode: "preset", id: event.target.value } } })}>
            <option value="" disabled>{text("Select a voice", "选择声音", "音声を選択")}</option>
            {tts?.voices.filter((voice) => voice.languages.includes(value.target_language)).map((voice) => <option key={voice.id} value={voice.id}>{voice.name}</option>)}
          </select>
        </div>}
      </div>}
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={value.keep_background} onChange={(event) => change({ keep_background: event.target.checked })} />{text("Keep background audio", "保留背景音", "背景音を残す")}</label>
      {value.separation && <ModelField kind="separation" label={text("Audio separation", "音源分离模型", "音源分離モデル")} value={value.separation} runtime={runtime} onChange={(separation) => change({ separation })} />}
    </div>}
  </div>
}
