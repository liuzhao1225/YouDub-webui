"use client"

import type { MessageKey } from '@/locales'
import { useState, type ReactNode } from "react"
import { ArrowRightLeft, AudioWaveform, Captions, Clapperboard, Languages, Mic, Speech, type LucideIcon } from "@/lib/icons"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Segmented } from "@/components/ui/segmented"
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import type { Capability, ModelCapability, ModelSelection, Runtime, TaskConfig, TtsSelection } from "@/plugin/builtin/localize-contracts"
import { useText, type Text } from "@/lib/i18n"

const OUTPUT_LABELS: Record<TaskConfig["output_mode"], MessageKey> = {
  "subtitles": "output_labels.subtitles",
  "dubbing": "output_labels.dubbing",
  "both": "output_labels.both"
}

const LANGUAGE_NAMES: Record<string, string> = { en: "English", zh: "中文", ja: "日本語" }

function languageName(code: string, text: Text) {
  if (code === "auto") return text("localize.task.config.auto.detect")
  return LANGUAGE_NAMES[code] ?? code
}

function deviceName(device: string, text: Text, runtime: Runtime) {
  if (device === "cpu") return "CPU"
  if (device === "remote") return text("localize.task.config.remote")
  if (device === "mps") return "Apple MPS"
  const entry = runtime.devices.find(item => item.id === device)
  if (entry?.backend === "rocm") return `AMD ROCm ${device.split(":")[1]}`
  return device.replace(/^cuda:/, "CUDA ")
}

type Kind = Capability["capability"]
type Choice = { value: ModelSelection; model: ModelCapability }

function choices(runtime: Runtime, kind: Kind): Choice[] {
  return runtime.capabilities.filter((item) => item.capability === kind && item.available).flatMap((item) => (
    item.models.filter(model => model.available !== false).flatMap((model) => model.devices.filter((device) => (
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

// 原文 / 目标语言的可选项，随所选识别、翻译与配音模型变化。
function languageChoices(config: TaskConfig, runtime: Runtime) {
  const asr = selectedModel(runtime, "asr", config.asr)
  const translation = selectedModel(runtime, "translation", config.translation)
  const tts = selectedModel(runtime, "tts", config.tts)
  return {
    sources: asr?.source_languages.filter((item) => item === "auto" || translation?.source_languages.includes(item)) ?? [],
    targets: translation?.target_languages.filter((item) => !config.tts || tts?.target_languages.includes(item)) ?? [],
  }
}

function updateConfig(config: TaskConfig, patch: Partial<TaskConfig>, runtime: Runtime) {
  return normalize({ ...config, ...patch }, runtime)
}

export function TaskOptions({ value, runtime, onChange }: {
  value: TaskConfig; runtime: Runtime; onChange: (value: TaskConfig) => void
}) {
  const text = useText()
  // Keep the configured models when a task temporarily switches to subtitles.
  const [defaults] = useState(value)
  const { sources, targets } = languageChoices(value, runtime)
  function change(patch: Partial<TaskConfig>) {
    const next = { ...value, ...patch }
    if (patch.output_mode && patch.output_mode !== "subtitles") {
      next.tts ??= defaults.tts
      next.keep_background = defaults.keep_background
      next.separation ??= defaults.separation
      if (patch.output_mode === "both") next.subtitle_alignment ??= defaults.subtitle_alignment
    }
    onChange(normalize(next, runtime))
  }
  const fields = [
    { id: "output-mode", label: text("localize.task.config.output"), aria: text("localize.task.config.output.content"), value: value.output_mode,
      display: text(OUTPUT_LABELS[value.output_mode]), options: Object.entries(OUTPUT_LABELS).map(([mode, label]) => ({ value: mode, label: text(label) })),
      change: (mode: string) => change({ output_mode: mode as TaskConfig["output_mode"] }) },
    { id: "source-language", label: text("localize.task.config.from"), aria: text("localize.task.config.source.language"), value: value.source_language,
      display: languageName(value.source_language, text), options: sources.map((code) => ({ value: code, label: languageName(code, text) })),
      change: (source_language: string) => change({ source_language }) },
    { id: "target-language", label: text("localize.task.config.to"), aria: text("localize.task.config.target.language"), value: value.target_language,
      display: languageName(value.target_language, text), options: targets.map((code) => ({ value: code, label: languageName(code, text) })),
      change: (target_language: string) => change({ target_language }) },
  ]
  return <div className="flex flex-wrap items-center gap-2">{fields.map((field) => (
    <Select key={field.id} value={field.value} onValueChange={(next) => { if (typeof next === "string") field.change(next) }}>
      <SelectTrigger id={field.id} aria-label={field.aria} className="inline-flex w-auto max-w-full gap-1.5">
        <span className="text-subtle-foreground">{field.label}</span><span className="min-w-0 truncate font-medium">{field.display}</span>
      </SelectTrigger>
      <SelectContent>{field.options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
    </Select>
  ))}</div>
}

const ADAPTER_NAMES: Record<string, MessageKey> = {
  "whisper": "adapter_names.whisper",
  "openai": "adapter_names.openai",
  "voxcpm": "adapter_names.voxcpm",
  "demucs": "adapter_names.demucs",
  "qwen_forced_aligner": "adapter_names.qwen_forced_aligner"
}

function adapterName(adapter: string, text: Text) {
  const name = ADAPTER_NAMES[adapter]
  return name ? text(name) : adapter
}

// 模型名为主，适配器与设备作为次要信息。
function ModelLabel({ value, text, runtime }: { value: ModelSelection; text: Text; runtime: Runtime }) {
  return <span className="min-w-0 truncate">
    <span className="font-medium text-foreground">{value.model}</span>{" "}
    <span className="text-subtle-foreground">{value.device === "remote"
      ? text("localize.task.config.remote.api")
      : `${adapterName(value.adapter, text)} · ${deviceName(value.device, text, runtime)}`}</span>
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
  return <div className="grid gap-3 py-4 @2xl:grid-cols-[minmax(0,13rem)_minmax(0,1fr)] @2xl:gap-6">
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
  const text = useText()
  const options = choices(runtime, kind)
  const selected = selectionKey(value)
  const known = options.some((item) => selectionKey(item.value) === selected)
  return <Field id={id} caption={caption} srPrefix={srPrefix}>
    <FieldSelect id={id} value={selected}
      display={value?.model ? <>
        <ModelLabel value={value} text={text} runtime={runtime} />
        {known ? null : <span className="ml-1.5 shrink-0 text-status-warning-fg">· {text("localize.task.config.unavailable")}</span>}
      </> : null}
      placeholder={text("localize.task.config.select.a.model")}
      options={[
        ...options.map((item) => ({ value: selectionKey(item.value), label: <ModelLabel value={item.value} text={text} runtime={runtime} /> })),
        ...runtime.capabilities.filter((item) => item.capability === kind && !item.available).map((item) => ({
          value: `unavailable-${item.adapter}`, label: `${item.adapter} — ${item.unavailable_reason ?? text("localize.task.config.unavailable")}`, disabled: true,
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
  const text = useText()
  return <Field id={id} caption={caption}>
    <FieldSelect id={id} value={value} display={value ? languageName(value, text) : null}
      placeholder={text("localize.task.config.select.a.language")}
      options={options.map((item) => ({ value: item, label: languageName(item, text) }))} onChange={onChange} />
  </Field>
}

export function TaskConfigForm({ value, runtime, onChange, showTranslation = true }: {
  value: TaskConfig; runtime: Runtime; onChange: (value: TaskConfig) => void; showTranslation?: boolean
}) {
  const text = useText()
  const tts = selectedModel(runtime, "tts", value.tts)
  const { sources, targets } = languageChoices(value, runtime)
  const alignmentOptions = choices(runtime, "subtitle_alignment").filter((item) => item.model.target_languages.includes(value.target_language))
  const alignmentKey = selectionKey(value.subtitle_alignment ?? null)
  const alignmentKnown = alignmentOptions.some((item) => selectionKey(item.value) === alignmentKey)
  const change = (patch: Partial<TaskConfig>) => onChange(updateConfig(value, patch, runtime))
  const presetVoices = tts?.voices.filter((voice) => voice.languages.includes(value.target_language)) ?? []
  const voice = value.tts?.voice
  const voiceModes = tts?.voice_modes ?? []
  const voiceModeLabel = (mode: string) => mode === "preset" ? text("localize.task.config.preset.voice") : text("localize.task.config.clone.source.voice")
  const dubbing = value.output_mode !== "subtitles"

  return <div className="@container divide-y divide-border">
      <ConfigRow icon={Clapperboard} tint="neutral" title={text("localize.task.config.output")}
        description={text("localize.task.config.subtitles.a.dubbed.cut.or.both")}>
        <Field id="output-mode" caption={text("localize.task.config.content")} srPrefix={text("localize.task.config.output.2")}>
          <FieldSelect id="output-mode" value={value.output_mode} display={text(OUTPUT_LABELS[value.output_mode])} placeholder=""
            options={Object.entries(OUTPUT_LABELS).map(([mode, label]) => ({ value: mode, label: text(label) }))}
            onChange={(next) => change({ output_mode: next as TaskConfig["output_mode"] })} />
        </Field>
      </ConfigRow>
      <ConfigRow icon={ArrowRightLeft} tint="violet" title={text("localize.task.config.languages")}
        description={text("localize.task.config.the.spoken.language.and.the.one.to.translate.into")}>
        <LanguageField id="source-language" caption={text("localize.task.config.source.language")} value={value.source_language} options={sources} onChange={(source_language) => change({ source_language })} />
        <LanguageField id="target-language" caption={text("localize.task.config.target.language")} value={value.target_language} options={targets} onChange={(target_language) => change({ target_language })} />
      </ConfigRow>

    <ConfigRow icon={Mic} tint="blue" title={text("localize.task.config.speech.recognition")}
      description={text("localize.task.config.turns.speech.into.text.name.hints.help.with.people.and.brands")}>
      <ModelField kind="asr" id="model-asr" caption={text("localize.task.config.model")} srPrefix={text("localize.task.config.speech.recognition.2")} value={value.asr} runtime={runtime} onChange={(asr) => change({ asr: { ...value.asr, ...asr } })} />
      <Field id="asr-initial-prompt" caption={text("localize.task.config.proper.name.hint.optional")}>
        <Input id="asr-initial-prompt" value={value.asr.initial_prompt ?? ""} aria-describedby="asr-initial-prompt-help"
          placeholder={text("localize.task.config.e.g.youdub.jensen.huang")}
          onChange={(event) => change({ asr: { ...value.asr, initial_prompt: event.target.value || null } })} />
        <p id="asr-initial-prompt-help" className="sr-only">{text("localize.task.config.add.people.or.brand.names.to.help.speech.recognition")}</p>
      </Field>
    </ConfigRow>

    {showTranslation && <ConfigRow icon={Languages} tint="violet" title={text("localize.task.config.translation")}
      description={text("localize.task.config.translates.the.transcript.sentence.by.sentence")}>
      <ModelField kind="translation" id="model-translation" caption={text("localize.task.config.model")} srPrefix={text("localize.task.config.translation.2")} value={value.translation} runtime={runtime} onChange={(translation) => change({ translation })} />
    </ConfigRow>}

    {value.output_mode === "both" ? <ConfigRow icon={Captions} tint="teal" title={text("localize.task.config.subtitles")}
      description={text("localize.task.config.qwen.can.align.subtitles.to.the.generated.speech.keeping.full.sen")}>
      <Field id="subtitle-alignment" caption={text("localize.task.config.timing")} srPrefix={text("localize.task.config.subtitle")}>
        <FieldSelect id="subtitle-alignment" value={value.subtitle_alignment ? alignmentKey : ESTIMATE_TIMING}
          display={value.subtitle_alignment
            ? `${value.subtitle_alignment.model} · ${alignmentKnown ? deviceName(value.subtitle_alignment.device, text, runtime) : text("localize.task.config.unavailable")}`
            : text("localize.task.config.estimate.by.text.length")}
          placeholder=""
          options={[
            { value: ESTIMATE_TIMING, label: text("localize.task.config.estimate.by.text.length") },
            ...alignmentOptions.map((item) => ({ value: selectionKey(item.value), label: `${item.value.model} · ${deviceName(item.value.device, text, runtime)}` })),
            ...runtime.capabilities.filter((item) => item.capability === "subtitle_alignment" && !item.available).map((item) => ({
              value: `unavailable-${item.adapter}`, label: `Qwen — ${item.unavailable_reason ?? text("localize.task.config.unavailable")}`, disabled: true,
            })),
          ]}
          onChange={(next) => change({ subtitle_alignment: alignmentOptions.find((item) => selectionKey(item.value) === next)?.value ?? null })} />
      </Field>
    </ConfigRow> : null}

    {dubbing ? <ConfigRow icon={Speech} tint="red" title={text("localize.task.config.dubbing")}
      description={text("localize.task.config.speaks.the.translation.in.the.target.language")}>
      <ModelField kind="tts" id="model-tts" caption={text("localize.task.config.model")} srPrefix={text("localize.task.config.voice")} value={value.tts} runtime={runtime} onChange={(selection) => change({ tts: selectTts(runtime, selection, value.target_language) })} />
      {value.tts && voice ? <Field caption={text("localize.task.config.voice.source")}>
        {voiceModes.length > 1 ? (
          <Segmented ariaLabel={text("localize.task.config.voice.source")} value={voice.mode} className="flex w-full"
            options={voiceModes.map((mode) => ({ value: mode, label: voiceModeLabel(mode) }))}
            onChange={(mode) => change({ tts: { ...value.tts!, voice: mode === "source_clone"
              ? { mode: "source_clone" } : { mode: "preset", id: presetVoices[0]?.id ?? "" } } })} />
        ) : (
          <Input readOnly aria-label={text("localize.task.config.voice.source")} value={voiceModes.includes(voice.mode) ? voiceModeLabel(voice.mode) : text("localize.task.config.unavailable")} />
        )}
      </Field> : null}
      {value.tts && voice?.mode === "preset" ? <Field id="voice-id" caption={text("localize.task.config.voice.2")}>
        <FieldSelect id="voice-id" value={voice.id} display={presetVoices.find((item) => item.id === voice.id)?.name ?? null}
          placeholder={text("localize.task.config.select.a.voice")}
          options={presetVoices.map((item) => ({ value: item.id, label: item.name }))}
          onChange={(id) => change({ tts: { ...value.tts!, voice: { mode: "preset", id } } })} />
      </Field> : null}
    </ConfigRow> : null}

    {dubbing ? <ConfigRow icon={AudioWaveform} tint="pink" title={text("localize.task.config.vocal.separation")}
      description={text("localize.task.config.separates.the.voice.from.music.and.ambience.for.voice.cloning.and")}>
      <Field caption={text("localize.task.config.background.audio")}>
        <label className="flex h-10 cursor-pointer items-center justify-between gap-3 rounded-lg border border-input bg-input-bg px-3 text-sm">
          <span id="keep-background-label">{text("localize.task.config.keep.background.audio")}</span>
          <Switch aria-label={text("localize.task.config.keep.background.audio")} aria-labelledby="keep-background-label" checked={value.keep_background} onCheckedChange={(checked) => change({ keep_background: checked })} />
        </label>
      </Field>
      {value.separation ? <ModelField kind="separation" id="model-separation" caption={text("localize.task.config.model")} srPrefix={text("localize.task.config.audio.separation")} value={value.separation} runtime={runtime} onChange={(separation) => change({ separation })} /> : null}
    </ConfigRow> : null}
  </div>
}
