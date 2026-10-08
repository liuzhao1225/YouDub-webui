"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { ChangeEvent, FormEvent, useState } from "react"
import { ArrowRight, BookmarkCheck, ChevronDown, Film, Loader2, SlidersHorizontal, TriangleAlert, Upload, X } from "lucide-react"

import { ApiError } from "@/lib/api"
import { formatBytes } from "@/lib/format"
import { cn } from "@/lib/utils"
import { createTask, deleteTask, getTask, patchSettings, type Runtime, type Settings, type TaskConfig } from "@/lib/v1-api"
import { OUTPUT_LABELS, languageName, useV1Text } from "@/lib/v1-ui"
import { InlineAlert } from "@/components/inline-alert"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select"
import { TaskConfigForm, configProblem, initialTaskConfig, languageChoices, updateConfig } from "@/components/v1-task-config"

export type StudioContext = { runtime: Runtime; settings: Settings }
type UploadRequest = { id: string; file: File; config: TaskConfig }

const CHIP_CLASS =
  "inline-flex h-8 w-auto items-center gap-1.5 rounded-full border border-border bg-muted px-3 text-[13px] shadow-none"

function OptionChip({ id, label, ariaLabel, value, display, options, onChange }: {
  id: string
  label: string
  ariaLabel: string
  value: string
  display: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
}) {
  return (
    <Select value={value} onValueChange={(next) => { if (typeof next === "string") onChange(next) }}>
      <SelectTrigger id={id} aria-label={ariaLabel} className={cn(CHIP_CLASS, "hover:bg-accent")}>
        <span className="text-subtle-foreground">{label}</span>
        <span className="min-w-0 truncate font-medium text-foreground">{display}</span>
      </SelectTrigger>
      <SelectContent className="min-w-48">
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function Notice({ children, id, actions }: { children: string; id: string; actions: React.ReactNode }) {
  return (
    <div role="status" className="space-y-3 rounded-xl border border-status-warning/30 bg-status-warning/10 p-3.5 text-sm text-status-warning-fg">
      <p className="flex items-start gap-2 leading-relaxed"><TriangleAlert className="mt-0.5 size-4 shrink-0" />{children}</p>
      <code className="block rounded-lg bg-card px-2.5 py-2 font-mono text-xs break-all text-foreground/85">{id}</code>
      <div className="flex flex-wrap gap-2">{actions}</div>
    </div>
  )
}

export function TaskComposer({ context, loading, loadError, onRetryLoad, onSettingsChange }: {
  context: StudioContext | null
  loading: boolean
  loadError: string
  onRetryLoad: () => void
  onSettingsChange: (settings: Settings) => void
}) {
  const router = useRouter()
  const text = useV1Text()
  // 未改动时跟随服务端默认配置；用户改过之后保留草稿。
  const [draft, setDraft] = useState<TaskConfig | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [fileInputKey, setFileInputKey] = useState(0)
  const [dragActive, setDragActive] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [uploadError, setUploadError] = useState("")
  const [upload, setUpload] = useState<UploadRequest | null>(null)
  const [failedUploadId, setFailedUploadId] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [savingDefaults, setSavingDefaults] = useState(false)
  const [savedMessage, setSavedMessage] = useState("")

  const config = draft ?? (context ? initialTaskConfig(context.runtime, context.settings) : null)
  const limits = context?.runtime.limits
  const problem = context && config ? configProblem(config, context.runtime, context.settings, text) : null
  const busy = submitting || savingDefaults || loading
  const languages = context && config ? languageChoices(config, context.runtime) : { sources: [], targets: [] }

  function changeConfig(next: TaskConfig) {
    setDraft(next)
    setSavedMessage("")
    setUploadError("")
  }

  function changeConfigField(patch: Partial<TaskConfig>) {
    if (!context || !config) return
    changeConfig(updateConfig(config, patch, context.runtime))
  }

  function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const next = event.target.files?.[0] ?? null
    setDragActive(false)
    setUploadError("")
    setFile(null)
    if (!next || !limits) return
    if (next.size > limits.max_file_bytes) setUploadError(text("Video exceeds the upload limit.", "视频超过上传大小限制。", "動画がアップロード上限を超えています。"))
    else if (!limits.video_suffixes.some((suffix) => next.name.toLowerCase().endsWith(suffix.toLowerCase()))) setUploadError(text("Unsupported video format.", "不支持该视频格式。", "対応していない動画形式です。"))
    else setFile(next)
  }

  function clearFile() {
    setFile(null)
    setUploadError("")
    setFileInputKey((value) => value + 1)
  }

  async function sendUpload(request: UploadRequest) {
    setSubmitting(true)
    setUpload(request)
    setUploadError("")
    try {
      const task = await createTask(request.file, request.config, request.id)
      router.push(`/tasks/${task.id}`)
    } catch (err) {
      if (err instanceof ApiError && err.code === "TASK_EXISTS") {
        router.push(`/tasks/${request.id}`)
      } else {
        setUploadError(err instanceof Error ? err.message : String(err))
        if (err instanceof ApiError && ([400, 413, 415, 422].includes(err.status) || err.code === "IMPORT_RESIDUE")) {
          setFailedUploadId(request.id)
          setUpload(null)
        }
      }
    } finally { setSubmitting(false) }
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!file || !config || problem || submitting || upload || failedUploadId || loading || loadError) return
    void sendUpload({ file, config, id: crypto.randomUUID() })
  }

  async function checkUpload() {
    if (!upload) return
    setSubmitting(true)
    setUploadError("")
    try {
      const task = await getTask(upload.id)
      router.push(`/tasks/${task.id}`)
    } catch (err) { setUploadError(err instanceof Error ? err.message : String(err)) }
    finally { setSubmitting(false) }
  }

  async function clearFailedUpload() {
    if (!failedUploadId || submitting) return
    setSubmitting(true)
    try {
      await deleteTask(failedUploadId)
      setFailedUploadId(null)
      setUploadError("")
    } catch (err) { setUploadError(err instanceof Error ? err.message : String(err)) }
    finally { setSubmitting(false) }
  }

  async function saveDefaults() {
    if (!config || problem || savingDefaults) return
    setSavingDefaults(true)
    setSavedMessage("")
    setUploadError("")
    try {
      onSettingsChange(await patchSettings({ defaults: config }))
      setSavedMessage(text("Saved for new tasks. Existing tasks keep their configuration.", "已保存为新任务默认值，已有任务配置保持不变。", "新しいタスクの初期設定を保存しました。既存のタスクには影響しません。"))
    } catch (err) { setUploadError(err instanceof Error ? err.message : String(err)) }
    finally { setSavingDefaults(false) }
  }

  const formats = limits?.video_suffixes.map((suffix) => suffix.replace(/^\./, "").toUpperCase()).join(" · ")
  const canSubmit = Boolean(file) && !problem && !busy && !upload && !failedUploadId && !loadError

  return (
    <div className="relative">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -inset-x-12 -inset-y-10 -z-10 bg-[radial-gradient(55%_60%_at_30%_45%,rgb(251_114_153/0.16),transparent_70%),radial-gradient(50%_60%_at_75%_55%,rgb(0_174_236/0.16),transparent_70%)] opacity-70 blur-2xl dark:opacity-100"
      />
      <form
        onSubmit={submit}
        className="relative rounded-[28px] p-px before:absolute before:inset-0 before:rounded-[inherit] before:bg-[linear-gradient(135deg,rgb(255_0_51/0.6),rgb(251_114_153/0.35)_42%,rgb(0_174_236/0.6))] before:opacity-45 before:transition-opacity before:duration-300 focus-within:before:opacity-100"
      >
        <div className="relative rounded-[27px] bg-card p-2 shadow-float">
          <fieldset disabled={busy || !!upload || !!loadError || !context} className="min-w-0">
            <label htmlFor="local-video" className="sr-only">{text("Local video", "本地视频", "ローカル動画")}</label>
            <div
              data-testid="local-upload-selection"
              aria-live="polite"
              onDragEnter={() => setDragActive(true)}
              onDragLeave={() => setDragActive(false)}
              onDrop={() => setDragActive(false)}
              className={cn(
                "relative flex min-h-[132px] items-center justify-center rounded-[20px] border border-dashed px-5 py-6 transition-colors",
                "has-[input:focus-visible]:border-ring has-[input:focus-visible]:ring-3 has-[input:focus-visible]:ring-ring/25",
                dragActive
                  ? "border-brand-blue bg-secondary"
                  : file
                    ? "border-border bg-muted"
                    : "border-input bg-muted hover:border-subtle-foreground/60 hover:bg-accent",
              )}
            >
              {/* 透明的原生文件框覆盖整块区域，点击和拖放都由浏览器原生处理。 */}
              <input
                key={fileInputKey}
                id="local-video"
                type="file"
                accept={limits?.video_suffixes.join(",")}
                onChange={selectFile}
                className="absolute inset-0 z-10 size-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
              />
              {file ? (
                <div className="flex w-full items-center gap-4">
                  <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,rgb(251_114_153/0.25),rgb(0_174_236/0.25))] text-foreground ring-1 ring-border ring-inset">
                    <Film className="size-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-medium text-foreground">{file.name}</p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      <span className="tabular-nums">{formatBytes(file.size)}</span>
                      <span aria-hidden="true"> · </span>
                      {text("Click or drop to replace", "点击或拖入以替换", "クリックまたはドロップで差し替え")}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="relative z-20"
                    onClick={clearFile}
                    aria-label={`${text("Remove", "移除", "削除")} ${file.name}`}
                  >
                    <X />
                  </Button>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2.5 text-center">
                  <span className="flex size-11 items-center justify-center rounded-full bg-card shadow-card ring-1 ring-border">
                    <Upload className="size-5 text-brand-blue" />
                  </span>
                  <p className="text-[15px] font-medium text-foreground">
                    {text("Drop a video here, or click to choose", "拖入视频，或点击选择文件", "動画をドロップ、またはクリックして選択")}
                  </p>
                  {limits ? (
                    <p className="text-xs tracking-wide text-subtle-foreground">
                      <span className="whitespace-nowrap">{formats}</span>
                      <span aria-hidden="true"> · </span>
                      <span className="whitespace-nowrap">{text("Up to", "最大", "上限")} {formatBytes(limits.max_file_bytes)}</span>
                      <span aria-hidden="true"> · </span>
                      <span className="whitespace-nowrap">
                        {text(`${limits.max_video_duration_ms / 60000} min max`, `${limits.max_video_duration_ms / 60000} 分钟以内`, `${limits.max_video_duration_ms / 60000} 分以内`)}
                      </span>
                    </p>
                  ) : null}
                </div>
              )}
            </div>

            <div className="mt-2 flex flex-col gap-3 border-t border-border px-2 pt-2.5 pb-1 sm:flex-row sm:items-center">
              <div className="flex flex-wrap items-center gap-2">
                {config ? (
                  <>
                    <OptionChip
                      id="composer-output"
                      label={text("Output", "输出", "出力")}
                      ariaLabel={text("Output", "输出内容", "出力内容")}
                      value={config.output_mode}
                      display={text(...OUTPUT_LABELS[config.output_mode])}
                      options={Object.entries(OUTPUT_LABELS).map(([mode, label]) => ({ value: mode, label: text(...label) }))}
                      onChange={(mode) => changeConfigField({ output_mode: mode as TaskConfig["output_mode"] })}
                    />
                    <span className="inline-flex items-center gap-1">
                      <OptionChip
                        id="composer-source"
                        label={text("From", "原文", "入力")}
                        ariaLabel={text("Source language", "原文语言", "入力言語")}
                        value={config.source_language}
                        display={config.source_language ? languageName(config.source_language, text) : "—"}
                        options={languages.sources.map((item) => ({ value: item, label: languageName(item, text) }))}
                        onChange={(source_language) => changeConfigField({ source_language })}
                      />
                      <ArrowRight aria-hidden="true" className="size-3.5 text-subtle-foreground" />
                      <OptionChip
                        id="composer-target"
                        label={text("To", "译文", "出力")}
                        ariaLabel={text("Target language", "目标语言", "出力言語")}
                        value={config.target_language}
                        display={config.target_language ? languageName(config.target_language, text) : "—"}
                        options={languages.targets.map((item) => ({ value: item, label: languageName(item, text) }))}
                        onChange={(target_language) => changeConfigField({ target_language })}
                      />
                    </span>
                    <button
                      type="button"
                      aria-expanded={advancedOpen}
                      aria-controls="composer-advanced"
                      onClick={() => setAdvancedOpen((open) => !open)}
                      className={cn(
                        CHIP_CLASS,
                        "font-medium text-foreground transition-colors outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/40 disabled:opacity-50",
                        advancedOpen && "border-input bg-accent",
                      )}
                    >
                      <SlidersHorizontal className="size-3.5 text-subtle-foreground" />
                      {text("More settings", "更多设置", "詳細設定")}
                      <ChevronDown className={cn("size-3.5 text-subtle-foreground transition-transform", advancedOpen && "rotate-180")} />
                    </button>
                  </>
                ) : (
                  <p className="flex h-8 items-center gap-2 px-1 text-[13px] text-muted-foreground">
                    {loading ? <Loader2 className="size-3.5 animate-spin" /> : null}
                    {loading
                      ? text("Checking this device…", "正在读取运行环境…", "実行環境を確認中…")
                      : text("Load the available models before creating a task.", "读取模型能力后即可配置任务。", "モデルの利用状況を読み込むとタスクを設定できます。")}
                  </p>
                )}
              </div>
              <Button type="submit" size="xl" className="w-full sm:ml-auto sm:w-auto" disabled={!canSubmit}>
                {submitting ? <Loader2 className="animate-spin" /> : <Upload />}
                {submitting
                  ? upload ? text("Uploading…", "上传中…", "アップロード中…") : text("Working…", "处理中…", "処理中…")
                  : text("Create task", "创建任务", "タスクを作成")}
              </Button>
            </div>

            {advancedOpen && config && context ? (
              <div
                id="composer-advanced"
                className="mt-2 animate-in overflow-hidden rounded-[20px] bg-muted ring-1 ring-border duration-200 ring-inset fade-in-0 slide-in-from-top-1"
              >
                <div className="px-4 sm:px-5">
                  <TaskConfigForm variant="advanced" value={config} runtime={context.runtime} onChange={changeConfig} />
                </div>
                <div className="flex flex-col gap-3 border-t border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                  <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
                    <BookmarkCheck className="mt-px size-3.5 shrink-0 text-subtle-foreground" />
                    {text(
                      "Save the current output, languages and models as defaults for new tasks.",
                      "把当前的输出、语言和模型保存为新任务的默认配置。",
                      "現在の出力・言語・モデルを新しいタスクの初期設定として保存します。",
                    )}
                  </p>
                  <Button type="button" variant="outline" size="sm" className="shrink-0" disabled={!!problem || busy || !!upload || !!loadError} onClick={saveDefaults}>
                    {savingDefaults ? <Loader2 className="animate-spin" /> : null}
                    {text("Save as defaults", "保存为默认配置", "初期設定として保存")}
                  </Button>
                </div>
              </div>
            ) : null}
          </fieldset>
        </div>
      </form>

      <div className="mt-4 space-y-3 empty:hidden">
        {loadError ? (
          <InlineAlert>
            <span className="flex flex-wrap items-center justify-between gap-2">
              <span>{loadError}</span>
              <Button type="button" variant="outline" size="xs" onClick={onRetryLoad}>{text("Reload", "重新加载", "再読み込み")}</Button>
            </span>
          </InlineAlert>
        ) : null}
        {problem ? (
          <InlineAlert tone="warning">
            {problem}{" "}
            <Link href="/settings" className="font-medium underline underline-offset-2">{text("Open settings", "打开设置", "設定を開く")}</Link>
          </InlineAlert>
        ) : null}
        {uploadError ? <InlineAlert>{uploadError}</InlineAlert> : null}
        {savedMessage ? <InlineAlert tone="info">{savedMessage}</InlineAlert> : null}
        {failedUploadId ? (
          <Notice
            id={failedUploadId}
            actions={
              <Button type="button" variant="outline" size="sm" disabled={submitting} onClick={clearFailedUpload}>
                {text("Clear failed upload", "清理本次失败上传", "失敗したアップロードを削除")}
              </Button>
            }
          >
            {text("The upload was rejected. You can adjust the file or configuration; clear this failed upload before submitting again.", "本次上传失败。可修改文件或配置，清理本次上传后再提交。", "アップロードに失敗しました。ファイルや設定を変更し、失敗したアップロードを削除してから再送信してください。")}
          </Notice>
        ) : null}
        {upload && !submitting ? (
          <Notice
            id={upload.id}
            actions={
              <>
                <Button type="button" variant="outline" size="sm" onClick={checkUpload}>{text("Check original task", "查询原任务", "元のタスクを確認")}</Button>
                <Button type="button" variant="outline" size="sm" onClick={() => void sendUpload(upload)}>{text("Resend with the same ID", "使用同一 ID 重新上传", "同じ ID で再送信")}</Button>
              </>
            }
          >
            {text("The upload result is unconfirmed. Check this task before starting another upload.", "上传结果尚未确认，请先查询原任务。", "アップロード結果を確認できていません。元のタスクを確認してください。")}
          </Notice>
        ) : null}
      </div>
    </div>
  )
}
