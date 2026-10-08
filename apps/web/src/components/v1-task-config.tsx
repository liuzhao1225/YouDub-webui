"use client"

import type { ReactNode } from "react"
import { ArrowRightLeft, AudioWaveform, Captions, Clapperboard, Languages, Mic, Speech, type LucideIcon } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Segmented } from "@/components/ui/segmented"
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import type { Capability, ModelCapability, ModelSelection, Runtime, Settings, TaskConfig, TtsSelection } from "@/lib/v1-api"
import { OUTPUT_LABELS, deviceName, languageName, useV1Text, type V1Text } from "@/lib/v1-ui"

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
  if (config.output_mode === "subtitles") return { ...config, keep_background: false, tts: null, separation: null, subtitle_alignment: null }
  const tts = config.tts ?? firstTts(runtime, config.target_language)
  const needsSeparation = config.keep_background || tts.voice.mode === "source_clone"
  return { ...config, tts, separation: needsSeparation ? config.separation ?? firstSelection(runtime, "separation") : null,
    subtitle_alignment: config.output_mode === "both" ? config.subtitle_alignment ?? null : null }
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
    output_mode: "subtitles", keep_background: false, asr, translation, tts: null, separation: null, subtitle_alignment: null,
  }
}

export function configProblem(config: TaskConfig, runtime: Runtime, settings: Settings, text: V1Text): string | null {
  if (config.subtitle_alignment && config.output_mode !== "both") return text("Subtitle alignment requires dubbing with subtitles.", "字幕对齐需要选择配音和字幕输出。", "字幕の位置合わせには吹き替えと字幕の出力が必要です。")
  for (const kind of ["asr", "translation", "tts", "separation", "subtitle_alignment"] as const) {
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
  const alignment = selectedModel(runtime, "subtitle_alignment", config.subtitle_alignment ?? null)
  if (!asr?.source_languages.includes(config.source_language)
    || (config.source_language !== "auto" && !translation?.source_languages.includes(config.source_language))
    || !translation?.target_languages.includes(config.target_language)
    || config.source_language === config.target_language
    || (config.tts && !tts?.target_languages.includes(config.target_language))
    || (config.subtitle_alignment && !alignment?.target_languages.includes(config.target_language))) {
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

// 原文 / 目标语言的可选项，随所选识别、翻译与配音模型变化。
export function languageChoices(config: TaskConfig, runtime: Runtime) {
  const asr = selectedModel(runtime, "asr", config.asr)
  const translation = selectedModel(runtime, "translation", config.translation)
  const tts = selectedModel(runtime, "tts", config.tts)
  return {
    sources: asr?.source_languages.filter((item) => item === "auto" || translation?.source_languages.includes(item)) ?? [],
    targets: translation?.target_languages.filter((item) => item !== config.source_language && (!config.tts || tts?.target_languages.includes(item))) ?? [],
  }
}

export function updateConfig(config: TaskConfig, patch: Partial<TaskConfig>, runtime: Runtime) {
  return normalize({ ...config, ...patch }, runtime)
}

const ADAPTER_NAMES: Record<string, [string, string, string]> = {
  whisper: ["Whisper", "Whisper", "Whisper"],
  openai: ["OpenAI-compatible", "OpenAI 兼容", "OpenAI 互換"],
  voxcpm: ["VoxCPM", "VoxCPM", "VoxCPM"],
  demucs: ["Demucs", "Demucs", "Demucs"],
  qwen_forced_aligner: ["Qwen", "Qwen", "Qwen"],
}

function adapterName(adapter: string, text: V1Text) {
  const name = ADAPTER_NAMES[adapter]
  return name ? text(...name) : adapter
}

// 模型名为主，适配器与设备作为次要信息。
function ModelLabel({ value, text }: { value: ModelSelection; text: V1Text }) {
  return <span className="min-w-0 truncate">
    <span className="font-medium text-foreground">{value.model}</span>{" "}
    <span className="text-subtle-foreground">{value.device === "remote"
      ? text("Remote API", "远端接口", "リモート API")
      : `${adapterName(value.adapter, text)} · ${deviceName(value.device, text)}`}</span>
  </span>
}

const ESTIMATE_TIMING = "estimate"

// 每组设置用一种 logo 色点缀图标。
const TINTS = {
  neutral: "bg-accent text-muted-foreground",
  blue: "bg-[rgb(0_174_236/0.14)] text-[#0277b5] dark:text-[#5ccbf5]",
  violet: "bg-[rgb(124_140_255/0.16)] text-[#5550d6] dark:text-[#a9b1ff]",
  teal: "bg-[rgb(45_212_191/0.15)] text-[#0f8a80] dark:text-[#5eead4]",
  red: "bg-[rgb(255_0_51/0.12)] text-[#d70a3c] dark:text-[#ff7a96]",
  pink: "bg-[rgb(251_114_153/0.15)] text-[#d6336c] dark:text-[#ff9dbb]",
}

type Option = { value: string; label: ReactNode; disabled?: boolean }

function ConfigRow({ icon: Icon, tint, title, description, children }: {
  icon: LucideIcon; tint: keyof typeof TINTS; title: string; description: string; children: ReactNode
}) {
  return <div className="grid gap-3 py-5 @2xl:grid-cols-[minmax(0,13rem)_minmax(0,1fr)] @2xl:gap-6">
    <div className="flex items-start gap-3">
      <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", TINTS[tint])}><Icon className="size-4" /></span>
      <div className="min-w-0">
        <p className="text-[13px] leading-5 font-medium text-foreground">{title}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{description}</p>
      </div>
    </div>
    <div className="grid min-w-0 content-start gap-3 @lg:grid-cols-2">{children}</div>
  </div>
}

// 可见的是简短说明；srPrefix 补全读屏时的完整名称（如“语音识别模型”）。
function Field({ id, caption, srPrefix, className, children }: {
  id?: string; caption: string; srPrefix?: string; className?: string; children: ReactNode
}) {
  const label = <>{srPrefix ? <span className="sr-only">{srPrefix}</span> : null}{caption}</>
  return <div className={cn("min-w-0 space-y-1.5", className)}>
    {id ? <Label htmlFor={id} className="flex h-5 items-center text-xs font-medium text-muted-foreground">{label}</Label>
      : <p className="flex h-5 items-center text-xs font-medium text-muted-foreground">{label}</p>}
    {children}
  </div>
}

function FieldSelect({ id, value, display, placeholder, options, onChange }: {
  id: string; value: string; display: ReactNode | null; placeholder: string; options: Option[]; onChange: (value: string) => void
}) {
  return <Select value={value} onValueChange={(next) => { if (typeof next === "string") onChange(next) }}>
    <SelectTrigger id={id}>
      <span className={cn("flex min-w-0 truncate text-left", !display && "text-subtle-foreground")}>{display ?? placeholder}</span>
    </SelectTrigger>
    <SelectContent>
      {options.map((option) => <SelectItem key={option.value} value={option.value} disabled={option.disabled}>{option.label}</SelectItem>)}
    </SelectContent>
  </Select>
}

function ModelField({ kind, id, caption, srPrefix, value, runtime, onChange }: {
  kind: Kind; id: string; caption: string; srPrefix: string; value: ModelSelection | null; runtime: Runtime; onChange: (value: ModelSelection) => void
}) {
  const text = useV1Text()
  const options = choices(runtime, kind)
  const selected = selectionKey(value)
  const known = options.some((item) => selectionKey(item.value) === selected)
  return <Field id={id} caption={caption} srPrefix={srPrefix}>
    <FieldSelect id={id} value={selected}
      display={value?.model ? <>
        <ModelLabel value={value} text={text} />
        {known ? null : <span className="ml-1.5 shrink-0 text-status-warning-fg">· {text("Unavailable", "不可用", "利用不可")}</span>}
      </> : null}
      placeholder={text("Select a model", "选择模型", "モデルを選択")}
      options={[
        ...options.map((item) => ({ value: selectionKey(item.value), label: <ModelLabel value={item.value} text={text} /> })),
        ...runtime.capabilities.filter((item) => item.capability === kind && !item.available).map((item) => ({
          value: `unavailable-${item.adapter}`, label: `${item.adapter} — ${item.unavailable_reason ?? text("Unavailable", "不可用", "利用不可")}`, disabled: true,
        })),
      ]}
      onChange={(next) => {
        const match = options.find((item) => selectionKey(item.value) === next)
        if (match) onChange(match.value)
      }} />
  </Field>
}

function LanguageField({ id, caption, value, options, onChange }: {
  id: string; caption: string; value: string; options: string[]; onChange: (value: string) => void
}) {
  const text = useV1Text()
  return <Field id={id} caption={caption}>
    <FieldSelect id={id} value={value} display={value ? languageName(value, text) : null}
      placeholder={text("Select a language", "选择语言", "言語を選択")}
      options={options.map((item) => ({ value: item, label: languageName(item, text) }))} onChange={onChange} />
  </Field>
}

// full：重新生成等需要完整配置的场景；advanced：工作台里输出内容和语言已放在选项条上，这里只给其余项。
export function TaskConfigForm({ value, runtime, onChange, variant = "full" }: {
  value: TaskConfig; runtime: Runtime; onChange: (value: TaskConfig) => void; variant?: "full" | "advanced"
}) {
  const text = useV1Text()
  const tts = selectedModel(runtime, "tts", value.tts)
  const { sources, targets } = languageChoices(value, runtime)
  const alignmentOptions = choices(runtime, "subtitle_alignment").filter((item) => item.model.target_languages.includes(value.target_language))
  const alignmentKey = selectionKey(value.subtitle_alignment ?? null)
  const alignmentKnown = alignmentOptions.some((item) => selectionKey(item.value) === alignmentKey)
  const change = (patch: Partial<TaskConfig>) => onChange(updateConfig(value, patch, runtime))
  const presetVoices = tts?.voices.filter((voice) => voice.languages.includes(value.target_language)) ?? []
  const voice = value.tts?.voice
  const voiceModes = tts?.voice_modes ?? []
  const voiceModeLabel = (mode: string) => mode === "preset" ? text("Preset voice", "预设声音", "プリセット音声") : text("Clone source voice", "克隆源音色", "元の声を複製")
  const dubbing = value.output_mode !== "subtitles"

  return <div className="@container divide-y divide-border">
    {variant === "full" ? <>
      <ConfigRow icon={Clapperboard} tint="neutral" title={text("Output", "输出", "出力")}
        description={text("Subtitles, a dubbed cut, or both.", "生成字幕、配音成片，或两者都要。", "字幕、吹き替え、またはその両方。")}>
        <Field id="output-mode" caption={text("Content", "内容", "内容")} srPrefix={text("Output ", "输出", "出力")}>
          <FieldSelect id="output-mode" value={value.output_mode} display={text(...OUTPUT_LABELS[value.output_mode])} placeholder=""
            options={Object.entries(OUTPUT_LABELS).map(([mode, label]) => ({ value: mode, label: text(...label) }))}
            onChange={(next) => change({ output_mode: next as TaskConfig["output_mode"] })} />
        </Field>
      </ConfigRow>
      <ConfigRow icon={ArrowRightLeft} tint="violet" title={text("Languages", "语言", "言語")}
        description={text("The spoken language and the one to translate into.", "视频原本的语言，以及要翻译成的语言。", "動画の言語と翻訳先の言語。")}>
        <LanguageField id="source-language" caption={text("Source language", "原文语言", "入力言語")} value={value.source_language} options={sources} onChange={(source_language) => change({ source_language })} />
        <LanguageField id="target-language" caption={text("Target language", "目标语言", "出力言語")} value={value.target_language} options={targets} onChange={(target_language) => change({ target_language })} />
      </ConfigRow>
    </> : null}

    <ConfigRow icon={Mic} tint="blue" title={text("Speech recognition", "语音识别", "音声認識")}
      description={text("Turns speech into text. Name hints help with people and brands.", "把语音转成文字，专名提示能让人名、品牌名更准确。", "音声を文字に変換します。固有名詞のヒントで人名やブランド名の精度が上がります。")}>
      <ModelField kind="asr" id="model-asr" caption={text("Model", "模型", "モデル")} srPrefix={text("Speech recognition ", "语音识别", "音声認識")} value={value.asr} runtime={runtime} onChange={(asr) => change({ asr: { ...value.asr, ...asr } })} />
      <Field id="asr-initial-prompt" caption={text("Proper-name hint (optional)", "专名提示（可选）", "固有名詞のヒント（任意）")}>
        <div className="relative">
          <Input id="asr-initial-prompt" maxLength={500} value={value.asr.initial_prompt ?? ""} aria-describedby="asr-initial-prompt-help" className="pr-16"
            placeholder={text("e.g. YouDub, Jensen Huang", "例如：YouDub、黄仁勋", "例：YouDub、ジェンスン・フアン")}
            onChange={(event) => change({ asr: { ...value.asr, initial_prompt: event.target.value || null } })} />
          <span aria-hidden="true" className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs tabular-nums text-subtle-foreground">{value.asr.initial_prompt?.length ?? 0}/500</span>
        </div>
        <p id="asr-initial-prompt-help" className="sr-only">{text("Add people or brand names to help speech recognition. Up to 500 characters.", "填写人名、品牌名，帮助语音识别。最多 500 字。", "人名やブランド名を入力すると音声認識の参考になります。500文字まで。")}</p>
      </Field>
    </ConfigRow>

    <ConfigRow icon={Languages} tint="violet" title={text("Translation", "翻译", "翻訳")}
      description={text("Translates the transcript sentence by sentence.", "逐句翻译识别出的原文。", "文字起こしを一文ずつ翻訳します。")}>
      <ModelField kind="translation" id="model-translation" caption={text("Model", "模型", "モデル")} srPrefix={text("Translation ", "翻译", "翻訳")} value={value.translation} runtime={runtime} onChange={(translation) => change({ translation })} />
    </ConfigRow>

    {value.output_mode === "both" ? <ConfigRow icon={Captions} tint="teal" title={text("Subtitles", "字幕", "字幕")}
      description={text("Qwen can align subtitles to the generated speech, keeping full-sentence dubbing.", "Qwen 可以按生成的配音对齐字幕，仍保持整句配音。", "Qwen は文全体の吹き替えを保ちながら、生成された音声に字幕を合わせます。")}>
      <Field id="subtitle-alignment" caption={text("Timing", "时间", "タイミング")} srPrefix={text("Subtitle ", "字幕", "字幕の")}>
        <FieldSelect id="subtitle-alignment" value={value.subtitle_alignment ? alignmentKey : ESTIMATE_TIMING}
          display={value.subtitle_alignment
            ? `${value.subtitle_alignment.model} · ${alignmentKnown ? deviceName(value.subtitle_alignment.device, text) : text("Unavailable", "不可用", "利用不可")}`
            : text("Estimate by text length", "按字数估算", "文字数から推定")}
          placeholder=""
          options={[
            { value: ESTIMATE_TIMING, label: text("Estimate by text length", "按字数估算", "文字数から推定") },
            ...alignmentOptions.map((item) => ({ value: selectionKey(item.value), label: `${item.value.model} · ${deviceName(item.value.device, text)}` })),
            ...runtime.capabilities.filter((item) => item.capability === "subtitle_alignment" && !item.available).map((item) => ({
              value: `unavailable-${item.adapter}`, label: `Qwen — ${item.unavailable_reason ?? text("Unavailable", "不可用", "利用不可")}`, disabled: true,
            })),
          ]}
          onChange={(next) => change({ subtitle_alignment: alignmentOptions.find((item) => selectionKey(item.value) === next)?.value ?? null })} />
      </Field>
    </ConfigRow> : null}

    {dubbing ? <ConfigRow icon={Speech} tint="red" title={text("Dubbing", "配音", "吹き替え")}
      description={text("Speaks the translation in the target language.", "用目标语言为译文配音。", "訳文を翻訳先の言語で読み上げます。")}>
      <ModelField kind="tts" id="model-tts" caption={text("Model", "模型", "モデル")} srPrefix={text("Voice ", "配音", "音声合成")} value={value.tts} runtime={runtime} onChange={(selection) => change({ tts: selectTts(runtime, selection, value.target_language) })} />
      {value.tts && voice ? <Field caption={text("Voice source", "声音方式", "声の選択方法")}>
        {voiceModes.length > 1 ? (
          <Segmented ariaLabel={text("Voice source", "声音方式", "声の選択方法")} value={voice.mode} className="flex h-10 w-full"
            options={voiceModes.map((mode) => ({ value: mode, label: voiceModeLabel(mode) }))}
            onChange={(mode) => change({ tts: { ...value.tts!, voice: mode === "source_clone"
              ? { mode: "source_clone" } : { mode: "preset", id: presetVoices[0]?.id ?? "" } } })} />
        ) : (
          <div role="group" aria-label={text("Voice source", "声音方式", "声の選択方法")}
            className={cn("flex h-10 items-center rounded-lg border border-input bg-input-bg px-3 text-sm", !voiceModes.includes(voice.mode) && "text-status-warning-fg")}>
            {voiceModes.includes(voice.mode) ? voiceModeLabel(voice.mode) : text("Unavailable", "不可用", "利用不可")}
          </div>
        )}
      </Field> : null}
      {value.tts && voice?.mode === "preset" ? <Field id="voice-id" caption={text("Voice", "声音", "音声")}>
        <FieldSelect id="voice-id" value={voice.id} display={presetVoices.find((item) => item.id === voice.id)?.name ?? null}
          placeholder={text("Select a voice", "选择声音", "音声を選択")}
          options={presetVoices.map((item) => ({ value: item.id, label: item.name }))}
          onChange={(id) => change({ tts: { ...value.tts!, voice: { mode: "preset", id } } })} />
      </Field> : null}
    </ConfigRow> : null}

    {dubbing ? <ConfigRow icon={AudioWaveform} tint="pink" title={text("Vocal separation", "人声分离", "音声分離")}
      description={text("Separates the voice from music and ambience, for voice cloning and keeping the background.", "把人声和背景声分开，用于克隆音色和保留背景音。", "声と背景音を分け、声の複製や背景音の保持に使います。")}>
      <Field caption={text("Background audio", "背景音", "背景音")}>
        <label className="flex h-10 cursor-pointer items-center justify-between gap-3 rounded-lg border border-input bg-input-bg px-3 text-sm">
          <span id="keep-background-label">{text("Keep background audio", "保留背景音", "背景音を残す")}</span>
          <Switch aria-labelledby="keep-background-label" checked={value.keep_background} onCheckedChange={(checked) => change({ keep_background: checked })} />
        </label>
      </Field>
      {value.separation ? <ModelField kind="separation" id="model-separation" caption={text("Model", "模型", "モデル")} srPrefix={text("Audio separation ", "音源分离", "音源分離")} value={value.separation} runtime={runtime} onChange={(separation) => change({ separation })} /> : null}
    </ConfigRow> : null}
  </div>
}
