"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { use, useCallback, useId, useRef, useState } from "react"
import {
  AudioLines,
  AudioWaveform,
  Captions,
  Check,
  ChevronDown,
  ChevronRight,
  CircleSlash,
  Clapperboard,
  Clock3,
  Download,
  FileText,
  Film,
  Languages,
  Mic,
  Minus,
  Speech,
  X,
  XCircle,
  type LucideIcon,
} from "lucide-react"

import { ApiError, isAbortError } from "@/lib/api"
import { durationOf, formatBytes, formatDateTime, formatMediaDuration } from "@/lib/format"
import { SerialPollingContext, useSerialPolling } from "@/lib/use-serial-polling"
import { cn } from "@/lib/utils"
import { getTask, type OutputFile, type OutputKind, type Stage, type Task } from "@/lib/v1-api"
import { OUTPUT_LABELS, STAGES, STAGE_LABELS, STATUS_LABELS, WAIT_LABELS, deviceName, isActiveStatus, languageName, useV1Text } from "@/lib/v1-ui"
import { Equalizer } from "@/components/brand/equalizer"
import { CopyButton } from "@/components/copy-button"
import { InlineAlert } from "@/components/inline-alert"
import { StatusBadge } from "@/components/status-badge"
import { TaskCover } from "@/components/task-cover"
import { TaskActions } from "@/components/v1-task-actions"
import { TaskLog } from "@/components/v1-task-log"
import { VideoPlayer } from "@/components/video-player"
import { Button, buttonVariants } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"

type StageState = "done" | "current" | "failed" | "cancelled" | "pending" | "skipped"

// 每个阶段的图标，以及读取所用模型的配置项（仅展示用）。
const STAGE_META: Record<Stage, { icon: LucideIcon; config?: "asr" | "translation" | "tts" | "separation" }> = {
  prepare: { icon: Film },
  separate: { icon: AudioWaveform, config: "separation" },
  asr: { icon: Mic, config: "asr" },
  translate: { icon: Languages, config: "translation" },
  tts: { icon: Speech, config: "tts" },
  mix: { icon: AudioLines },
  export: { icon: Clapperboard },
}

const FILE_LABELS: Record<OutputKind, [string, string, string]> = {
  video: ["Video", "成品视频", "完成動画"],
  audio: ["Mixed audio", "最终混音", "ミックス済み音声"],
  source_subtitles: ["Source subtitles", "原文字幕", "原文字幕"],
  translated_subtitles: ["Translated subtitles", "译文字幕", "翻訳字幕"],
}

const FILE_ICONS: Record<OutputKind, LucideIcon> = {
  video: Film,
  audio: AudioLines,
  source_subtitles: FileText,
  translated_subtitles: Captions,
}

function skippedStages(task: Task): Stage[] {
  return STAGES.filter((stage) => (stage === "separate" && !task.config.separation)
    || (task.config.output_mode === "subtitles" && (stage === "tts" || stage === "mix")))
}

function stageState(stage: Stage, task: Task, skipped: Stage[]): StageState {
  if (skipped.includes(stage)) return "skipped"
  if (task.current_stage === "done") return "done"
  const index = STAGES.indexOf(stage)
  const current = STAGES.indexOf(task.current_stage)
  if (index < current) return "done"
  if (index > current) return "pending"
  if (task.status === "failed") return "failed"
  if (task.status === "cancelled") return "cancelled"
  return "current"
}

function StageNode({ state, stage, moving }: { state: StageState; stage: Stage; moving: boolean }) {
  const Icon = STAGE_META[stage].icon
  const base = "relative z-10 flex size-9 shrink-0 items-center justify-center rounded-xl ring-4 ring-card"
  if (state === "done") {
    return (
      <span className={cn(base, "bg-status-success/15 text-status-success-fg")}>
        <Icon className="size-4" />
        <span className="absolute -right-1 -bottom-1 flex size-4 items-center justify-center rounded-full bg-status-success text-white ring-2 ring-card">
          <Check className="size-2.5" strokeWidth={3.5} />
        </span>
      </span>
    )
  }
  if (state === "current" && moving) {
    return (
      <span className={cn(base, "bg-status-running text-white shadow-[0_0_20px_rgb(251_114_153/0.55)]")}>
        <Icon className="size-4" />
        <span className="absolute inset-0 animate-ping rounded-xl bg-status-running/30" aria-hidden="true" />
      </span>
    )
  }
  if (state === "current") {
    return (
      <span className={cn(base, "border border-status-running/40 bg-status-running/10 text-status-running-fg")}>
        <Icon className="size-4" />
      </span>
    )
  }
  if (state === "failed") {
    return (
      <span className={cn(base, "bg-status-danger text-white")}>
        <X className="size-4" strokeWidth={2.75} />
      </span>
    )
  }
  if (state === "cancelled") {
    return (
      <span className={cn(base, "bg-status-neutral/20 text-status-neutral-fg")}>
        <CircleSlash className="size-4" />
      </span>
    )
  }
  if (state === "skipped") {
    return (
      <span className={cn(base, "border border-dashed border-input bg-accent text-subtle-foreground")}>
        <Minus className="size-4" strokeWidth={2.5} />
      </span>
    )
  }
  return (
    <span className={cn(base, "border border-border bg-card text-subtle-foreground")}>
      <Icon className="size-4" />
    </span>
  )
}

function ProgressRing({ value, status, label }: { value: number; status: Task["status"]; label: string }) {
  const gradientId = `${useId()}-ring`
  const radius = 42
  const circumference = 2 * Math.PI * radius
  const stroke = status === "failed"
    ? "var(--status-danger)"
    : status === "cancelled" || status === "cancelling"
      ? "var(--status-neutral)"
      : `url(#${gradientId})`
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
      className="relative size-[88px] shrink-0"
    >
      <svg viewBox="0 0 100 100" className="size-full -rotate-90" aria-hidden="true">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" style={{ stopColor: "var(--brand-pink)" }} />
            <stop offset="100%" style={{ stopColor: "var(--brand-blue)" }} />
          </linearGradient>
        </defs>
        <circle cx="50" cy="50" r={radius} fill="none" strokeWidth="8" style={{ stroke: "var(--accent)" }} />
        <circle
          cx="50"
          cy="50"
          r={radius}
          fill="none"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - value / 100)}
          style={{ stroke }}
          className="transition-[stroke-dashoffset] duration-700 ease-out"
        />
      </svg>
      <span className="absolute inset-0 flex items-baseline justify-center pt-[30px] text-[22px] font-semibold tabular-nums">
        {value}
        <span className="ml-0.5 text-xs font-medium text-muted-foreground">%</span>
      </span>
    </div>
  )
}

function MetaChip({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="inline-flex h-7 items-center gap-1.5 rounded-full border border-border bg-muted px-2.5 text-xs text-foreground/85">
      {icon}
      {children}
    </span>
  )
}

function Section({ title, aside, children, className }: {
  title: string
  aside?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={cn("rounded-2xl border border-border bg-card shadow-card", className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-border px-5 pt-5 pb-4">
        <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
        {aside ? <span className="text-[13px] text-muted-foreground">{aside}</span> : null}
      </div>
      <div className="px-5 py-5">{children}</div>
    </section>
  )
}

export default function TaskDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const text = useV1Text()
  const [task, setTask] = useState<Task | null>(null)
  const [error, setError] = useState("")
  const [mediaError, setMediaError] = useState("")
  const [showLog, setShowLog] = useState(false)
  // 删除确认框打开时先卸载播放器，断开对产物文件的读取。
  const [releaseMedia, setReleaseMedia] = useState(false)
  const mutationPending = useRef(false)
  const navigatingAway = useRef(false)

  const pollTask = useCallback(async ({ signal, isCurrent }: SerialPollingContext) => {
    if (mutationPending.current) return
    try {
      const next = await getTask(id, signal)
      if (isCurrent() && !mutationPending.current) { setTask(next); setError("") }
    } catch (err) {
      if (isCurrent() && !mutationPending.current && !isAbortError(err)) {
        setError(err instanceof Error ? err.message : String(err))
        if (err instanceof ApiError && err.status === 404) setTask(null)
      }
    }
  }, [id])
  const invalidatePolling = useSerialPolling(pollTask)

  const backLink = (
    <nav className="flex min-w-0 items-center gap-1.5 text-[13px] text-muted-foreground">
      <Link href="/tasks" className="shrink-0 rounded-md font-medium transition-colors hover:text-foreground">
        {text("Library", "任务库", "ライブラリ")}
      </Link>
      <ChevronRight className="size-3.5 shrink-0 text-subtle-foreground" aria-hidden="true" />
      <span className="truncate text-foreground/80">{task ? task.source_name : text("Loading task…", "正在读取任务…", "タスクを読み込み中…")}</span>
    </nav>
  )

  if (!task) {
    return (
      <div className="mx-auto max-w-6xl px-5 py-8 sm:px-8 lg:py-10" aria-busy={!error}>
        {backLink}
        {error ? (
          <InlineAlert className="mt-6">{error}</InlineAlert>
        ) : (
          <>
            <p className="sr-only">{text("Loading task…", "正在读取任务…", "タスクを読み込み中…")}</p>
            <div className="mt-6 space-y-3">
              <Skeleton className="h-9 w-3/5" />
              <Skeleton className="h-6 w-2/5" />
            </div>
            <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
              <Skeleton className="aspect-video rounded-2xl" />
              <Skeleton className="h-80 rounded-2xl" />
            </div>
          </>
        )}
      </div>
    )
  }

  const skipped = skippedStages(task)
  const states = STAGES.map((stage) => stageState(stage, task, skipped))
  const applicable = STAGES.length - skipped.length
  const doneCount = states.filter((state) => state === "done").length
  const moving = task.status === "running" || task.status === "waiting"
  const stageProgress = task.stage_progress !== null && task.current_stage !== "done" ? Math.round(task.stage_progress * 100) : null
  const overall = task.status === "succeeded"
    ? 100
    : Math.min(99, Math.round(((doneCount + (moving && stageProgress !== null ? stageProgress / 100 : 0)) / Math.max(1, applicable)) * 100))
  const stepNumber = task.current_stage === "done" ? applicable : Math.min(applicable, doneCount + 1)
  const totalDuration = task.started_at ? durationOf(task.started_at, task.finished_at) : ""
  // 成片在顶部播放器预览、状态卡下载；字幕与混音音轨列在下载按钮下方。
  const otherOutputs = (Object.entries(task.outputs) as [OutputKind, OutputFile][]).filter(([kind]) => kind !== "video")
  const video = task.outputs.video
  const headline = task.status === "succeeded"
    ? text("Ready", "成品已生成", "完成しました")
    : task.status === "failed"
      ? text("Processing failed", "处理失败", "処理に失敗しました")
      : task.status === "cancelled"
        ? text("Cancelled", "已取消", "キャンセルしました")
        : task.status === "cancelling"
          ? text("Stopping…", "正在停止…", "停止中…")
          : task.status === "queued" && task.current_stage === "prepare" && !task.started_at
            ? text("Waiting to start", "等待开始", "開始待ち")
            : text(...STAGE_LABELS[task.current_stage])
  const languagesText = `${languageName(task.config.source_language, text)} → ${languageName(task.config.target_language, text)}`
  const previewIcon = moving ? <Equalizer className="h-5 gap-[3px] [&>span]:w-[3px]" />
    : task.status === "failed" ? <XCircle className="size-6" />
      : task.status === "cancelled" || task.status === "cancelling" ? <CircleSlash className="size-6" />
        : <Clock3 className="size-6" />

  return (
    <div className="mx-auto max-w-6xl px-5 py-8 sm:px-8 lg:py-10">
      {backLink}

      <header className="mt-5 animate-rise">
        <h1 className="text-2xl leading-tight font-semibold tracking-tight break-words sm:text-[30px]">{task.source_name}</h1>
        <div className="mt-3.5 flex flex-wrap items-center gap-2">
          <StatusBadge status={task.status} className="h-7 px-3">{text(...STATUS_LABELS[task.status])}</StatusBadge>
          <MetaChip icon={<Clapperboard className="size-3.5 text-subtle-foreground" />}>{text(...OUTPUT_LABELS[task.config.output_mode])}</MetaChip>
          <MetaChip icon={<Languages className="size-3.5 text-subtle-foreground" />}>{languagesText}</MetaChip>
          <MetaChip icon={<Film className="size-3.5 text-subtle-foreground" />}>
            <span className="tabular-nums">
              {[formatMediaDuration(task.source_duration_ms), formatBytes(task.source_size_bytes)].filter(Boolean).join(" · ")}
            </span>
          </MetaChip>
        </div>
      </header>

      {error ? <InlineAlert className="mt-5">{error}</InlineAlert> : null}

      {/* 窄屏按「成片 → 状态 → 流程 → 其余信息」排列，宽屏分为左右两栏。 */}
      <div className="mt-7 flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <div className="contents lg:flex lg:min-w-0 lg:flex-col lg:gap-6">
          <section className="relative order-1 animate-rise [animation-delay:60ms]">
            <div
              aria-hidden="true"
              className="absolute -inset-x-4 -inset-y-6 -z-10 bg-[radial-gradient(50%_60%_at_25%_50%,rgb(251_114_153/0.18),transparent_70%),radial-gradient(50%_60%_at_75%_50%,rgb(0_174_236/0.18),transparent_70%)] opacity-60 blur-2xl dark:opacity-100"
            />
            {video && !releaseMedia ? (
              <VideoPlayer
                key={video.url}
                src={video.url}
                className="rounded-2xl border border-border shadow-float"
                onError={() => setMediaError(text("Unable to load the video preview. Check the file download.", "视频预览读取失败，请检查成品下载。", "動画プレビューを読み込めません。ファイルのダウンロードを確認してください。"))}
              />
            ) : (
              <div className="relative isolate overflow-hidden rounded-2xl border border-border shadow-float">
                <TaskCover id={task.id} size="lg" bars={false} className="w-full rounded-none ring-0" />
                <div aria-hidden="true" className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgb(0_0_0/0.2),rgb(0_0_0/0.72))]" />
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-white">
                  <span className="flex size-14 items-center justify-center rounded-full bg-white/10 ring-1 ring-white/20 backdrop-blur-md">
                    {previewIcon}
                  </span>
                  <p className="text-base font-semibold sm:text-lg">
                    {video ? text("Preview paused", "预览已暂停", "プレビューを一時停止中") : text("The preview appears after export", "导出完成后在这里预览", "書き出しが終わるとここでプレビューできます")}
                  </p>
                  <p className="text-sm text-white/70">
                    {moving && stageProgress !== null ? `${headline} · ${stageProgress}%` : headline}
                  </p>
                  {moving && stageProgress !== null ? (
                    <div className="mt-1 h-1 w-48 overflow-hidden rounded-full bg-white/15">
                      <div className="h-full rounded-full bg-brand-gradient transition-[width] duration-500" style={{ width: `${stageProgress}%` }} />
                    </div>
                  ) : null}
                </div>
              </div>
            )}
            {mediaError ? <InlineAlert className="mt-3">{mediaError}</InlineAlert> : null}
          </section>

          <Section
            className="order-3"
            title={text("Processing steps", "处理流程", "処理手順")}
            aside={<span className="tabular-nums">{text(`${doneCount} of ${applicable} steps done`, `已完成 ${doneCount}/${applicable} 个阶段`, `${applicable} ステップ中 ${doneCount} 完了`)}</span>}
          >
            <ol aria-label={text("Processing steps", "处理流程", "処理手順")}>
              {STAGES.map((stage, index) => {
                const state = states[index]
                const configKey = STAGE_META[stage].config
                const selection = configKey ? task.config[configKey] : null
                return (
                  <li key={stage} aria-current={state === "current" ? "step" : undefined} className="relative flex gap-4 pb-5 last:pb-0">
                    {index < STAGES.length - 1 ? (
                      <span
                        aria-hidden="true"
                        className={cn(
                          "absolute top-9 bottom-0 left-[18px] w-px -translate-x-1/2",
                          state === "done" ? "bg-status-success/40" : "bg-border",
                        )}
                      />
                    ) : null}
                    <StageNode state={state} stage={stage} moving={moving} />
                    <div className="min-w-0 flex-1 pt-1.5">
                      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                        <p className={cn("text-sm font-medium", state === "pending" || state === "skipped" ? "text-muted-foreground" : "text-foreground")}>
                          {text(...STAGE_LABELS[stage])}
                        </p>
                        {selection && state !== "skipped" ? (
                          <span className="rounded-md bg-accent px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{selection.model}</span>
                        ) : null}
                        {state === "skipped" ? (
                          <span className="text-xs text-subtle-foreground">{text("Skipped", "已跳过", "スキップ")}</span>
                        ) : state === "current" ? (
                          <StatusBadge status={task.status}>{text(...STATUS_LABELS[task.status])}</StatusBadge>
                        ) : state === "failed" ? (
                          <StatusBadge status="failed">{text(...STATUS_LABELS.failed)}</StatusBadge>
                        ) : state === "cancelled" ? (
                          <StatusBadge status="cancelled">{text(...STATUS_LABELS.cancelled)}</StatusBadge>
                        ) : null}
                      </div>
                      {state === "current" && task.wait_reason ? (
                        <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{text(...WAIT_LABELS[task.wait_reason])}</p>
                      ) : null}
                      {(state === "current" || state === "failed") && stageProgress !== null ? (
                        <div className="mt-2.5 flex items-center gap-3">
                          <Progress
                            aria-label={text("Current step progress", "当前阶段进度", "現在の処理の進捗")}
                            value={stageProgress}
                            className="min-w-0 flex-1"
                            indicatorClassName={state === "failed" ? "bg-status-danger" : "bg-brand-gradient"}
                          />
                          <span className="w-10 text-right text-xs font-medium tabular-nums text-status-running-fg">{stageProgress}%</span>
                        </div>
                      ) : null}
                    </div>
                  </li>
                )
              })}
            </ol>
          </Section>


          <Section
            className="order-4"
            title={text("Task configuration", "本次任务配置", "このタスクの設定")}
            aside={text("Fixed when the task was created", "创建任务时固定", "作成時に固定")}
          >
            <dl className="grid gap-x-6 gap-y-3 text-[13px] sm:grid-cols-[140px_minmax(0,1fr)]">
              <dt className="text-muted-foreground">{text("Languages", "语言", "言語")}</dt>
              <dd>{languagesText}</dd>
              <dt className="text-muted-foreground">{text("Output", "输出内容", "出力内容")}</dt>
              <dd>{text(...OUTPUT_LABELS[task.config.output_mode])}</dd>
              {task.config.output_mode === "both" ? (
                <>
                  <dt className="text-muted-foreground">{text("Subtitle timing", "字幕时间", "字幕のタイミング")}</dt>
                  <dd>{task.config.subtitle_alignment
                    ? `${task.config.subtitle_alignment.model} · ${deviceName(task.config.subtitle_alignment.device, text)}`
                    : text("Estimate by text length", "按字数估算", "文字数から推定")}</dd>
                </>
              ) : null}
              <dt className="text-muted-foreground">{text("Background audio", "背景音", "背景音")}</dt>
              <dd>{task.config.keep_background ? text("Keep", "保留", "保持") : text("Off", "不保留", "なし")}</dd>
              {(["asr", "translation", "tts", "separation"] as const).map((kind) => {
                const selection = task.config[kind]
                if (!selection) return null
                return (
                  <div key={kind} className="contents">
                    <dt className="text-muted-foreground">{text(...STAGE_LABELS[kind === "translation" ? "translate" : kind === "separation" ? "separate" : kind])}</dt>
                    <dd className="font-mono text-xs leading-5 break-words">{selection.adapter} / {selection.model} · {deviceName(selection.device, text)}</dd>
                  </div>
                )
              })}
              {task.config.tts ? (
                <>
                  <dt className="text-muted-foreground">{text("Voice", "声音", "音声")}</dt>
                  <dd>{task.config.tts.voice.mode === "preset" ? task.config.tts.voice.id : text("Source voice clone", "克隆源音色", "元の声を複製")}</dd>
                </>
              ) : null}
              {task.config.asr.initial_prompt ? (
                <>
                  <dt className="text-muted-foreground">{text("Proper-name hint", "专名提示", "固有名詞のヒント")}</dt>
                  <dd className="break-words">{task.config.asr.initial_prompt}</dd>
                </>
              ) : null}
            </dl>
          </Section>

          <section className="order-5 rounded-2xl border border-border bg-card shadow-card">
            <button
              type="button"
              aria-expanded={showLog}
              aria-controls="task-log"
              onClick={() => setShowLog((open) => !open)}
              className="flex w-full items-center justify-between gap-3 rounded-2xl px-5 py-4 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
            >
              <span className="text-[15px] font-semibold tracking-tight">{text("Task log", "任务日志", "タスクログ")}</span>
              <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", showLog && "rotate-180")} />
            </button>
            {showLog ? (
              <div id="task-log" className="border-t border-border px-5 py-5">
                <TaskLog key={`${task.id}-${task.attempt}`} id={task.id} />
              </div>
            ) : null}
          </section>
        </div>

        <aside className="contents lg:sticky lg:top-6 lg:flex lg:flex-col lg:gap-6">
          <section className="order-2 rounded-2xl border border-border bg-card p-5 shadow-card">
            <div className="flex items-center gap-4">
              <ProgressRing value={overall} status={task.status} label={text("Overall progress", "整体进度", "全体の進捗")} />
              <div className="min-w-0">
                {moving ? <p className="text-xs font-medium text-status-running-fg">{text("Current step", "当前阶段", "現在の処理")}</p> : null}
                <h2 className="mt-0.5 text-lg leading-snug font-semibold tracking-tight">{headline}</h2>
                <p className="mt-1 text-[13px] tabular-nums text-muted-foreground">
                  {text(`Step ${stepNumber} of ${applicable}`, `第 ${stepNumber}/${applicable} 步`, `${applicable} ステップ中 ${stepNumber}`)}
                  {totalDuration ? ` · ${totalDuration}` : ""}
                </p>
              </div>
            </div>
            {task.wait_reason || task.message ? (
              <div className="mt-4 space-y-1 text-[13px] leading-relaxed text-muted-foreground">
                {task.wait_reason ? <p>{text(...WAIT_LABELS[task.wait_reason])}</p> : null}
                {task.message ? <p>{task.message}</p> : null}
              </div>
            ) : null}

            {task.error ? (
              <div role="alert" className="mt-4 space-y-2 rounded-xl border border-status-danger/25 bg-status-danger/10 px-3.5 py-3 text-[13px] leading-relaxed text-status-danger-fg">
                <p className="font-medium break-words">{task.error.message}</p>
                <p className="font-mono text-xs break-all opacity-80">{task.error.code}{task.error.field ? ` · ${task.error.field}` : ""}</p>
                {task.error.action === "adjust_settings" ? (
                  <p>
                    {text("Review the model connection in Settings before creating a new task.", "请在设置中检查模型连接后创建新任务。", "設定でモデルの接続を確認してから新しいタスクを作成してください。")}{" "}
                    <Link href="/settings" className="font-medium underline underline-offset-2">{text("Open settings", "打开设置", "設定を開く")}</Link>
                  </p>
                ) : null}
              </div>
            ) : null}
            {task.external_operation.may_still_run ? (
              <InlineAlert tone="warning" className="mt-4">
                {text("The remote request may still be running. Its final result is unconfirmed.", "远端请求可能仍在执行，最终结果尚未确认。", "外部サービスのリクエストは実行中の可能性があり、最終結果は未確認です。")}
              </InlineAlert>
            ) : null}

            <div className="mt-5 space-y-2.5 border-t border-border pt-5">
              {video ? (
                <a href={`${video.url}?download=true`} download={video.file_name} className={buttonVariants({ size: "lg", className: "w-full" })}>
                  <Download />
                  {text("Download video", "下载成品视频", "動画をダウンロード")}
                </a>
              ) : isActiveStatus(task.status) ? (
                <>
                  <Button size="lg" variant="outline" className="w-full" disabled>
                    <Download />
                    {text("Download video", "下载成品视频", "動画をダウンロード")}
                  </Button>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {text("The video can be downloaded after export completes.", "导出完成后即可下载成品。", "書き出しが終わるとダウンロードできます。")}
                  </p>
                </>
              ) : null}
              {otherOutputs.length ? (
                <div className="rounded-xl border border-border bg-muted p-1.5">
                  <p className="px-2 pt-1 pb-1.5 text-[11px] font-medium text-subtle-foreground">{text("Other outputs", "其他成品", "その他の出力")}</p>
                  <ul aria-label={text("Output files", "成品文件", "出力ファイル")} className="space-y-0.5">
                    {otherOutputs.map(([kind, file]) => {
                      const Icon = FILE_ICONS[kind]
                      const label = text(...FILE_LABELS[kind])
                      return (
                        <li key={kind} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-accent">
                          <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-accent text-muted-foreground">
                            <Icon className="size-3.5" />
                          </span>
                          <a
                            href={file.url}
                            target="_blank"
                            rel="noreferrer"
                            title={text("Open in a new tab", "在新标签页打开", "新しいタブで開く")}
                            className="min-w-0 flex-1 rounded outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
                          >
                            <span className="block truncate text-[13px] font-medium text-foreground">{label}</span>
                            <span className="block truncate text-[11px] text-muted-foreground">{file.file_name} · {formatBytes(file.size_bytes)}</span>
                          </a>
                          <a
                            href={`${file.url}?download=true`}
                            download={file.file_name}
                            aria-label={`${text("Download", "下载", "ダウンロード")} ${label}`}
                            className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
                          >
                            <Download />
                          </a>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              ) : null}
              <TaskActions
                task={task}
                onMutationStart={() => {
                  mutationPending.current = true
                  invalidatePolling()
                }}
                onMutationEnd={() => {
                  invalidatePolling()
                  mutationPending.current = navigatingAway.current
                }}
                onTaskChange={(next) => {
                  invalidatePolling()
                  setTask(next)
                  setError("")
                  setMediaError("")
                }}
                onDeleted={() => {
                  navigatingAway.current = true
                  setTask(null)
                  router.replace("/tasks")
                }}
                onDeleteDialogChange={setReleaseMedia}
              />
            </div>
          </section>

          <section className="order-6 rounded-2xl border border-border bg-card p-5 shadow-card">
            <h2 className="text-[15px] font-semibold tracking-tight">{text("Overview", "概览", "概要")}</h2>
            <dl className="mt-4 space-y-3.5 text-[13px]">
              <div className="flex items-center justify-between gap-3">
                <dt className="shrink-0 text-muted-foreground">{text("Task ID", "任务 ID", "タスク ID")}</dt>
                <dd className="flex min-w-0 items-center gap-1">
                  <span className="truncate font-mono text-xs">{task.id}</span>
                  <CopyButton value={task.id} />
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="shrink-0 text-muted-foreground">{text("Attempt", "执行次数", "実行回数")}</dt>
                <dd className="tabular-nums">{task.attempt}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="shrink-0 text-muted-foreground">{text("Created", "创建时间", "作成日時")}</dt>
                <dd className="text-right tabular-nums">{formatDateTime(task.created_at)}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="shrink-0 text-muted-foreground">{text("Started", "开始时间", "開始日時")}</dt>
                <dd className="text-right tabular-nums">{formatDateTime(task.started_at) || "—"}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="shrink-0 text-muted-foreground">{text("Finished", "结束时间", "終了日時")}</dt>
                <dd className="text-right tabular-nums">{formatDateTime(task.finished_at) || "—"}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="shrink-0 text-muted-foreground">{text("Duration", "耗时", "所要時間")}</dt>
                <dd className="text-right font-mono text-xs tabular-nums">{totalDuration || "—"}</dd>
              </div>
              <div className="flex items-center justify-between gap-3 border-t border-border pt-3.5">
                <dt className="shrink-0 text-muted-foreground">{text("Pipeline", "流程版本", "パイプライン")}</dt>
                <dd className="truncate font-mono text-xs">{task.pipeline_version}</dd>
              </div>
            </dl>
          </section>
        </aside>
      </div>
    </div>
  )
}
