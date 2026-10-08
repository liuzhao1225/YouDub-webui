"use client"

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"
import {
  ArrowRight,
  AudioWaveform,
  Captions,
  ChevronRight,
  Languages,
  Mic,
  RefreshCw,
  Sparkles,
  type LucideIcon,
} from "lucide-react"

import { isAbortError } from "@/lib/api"
import { formatBytes, formatDateTime, formatMediaDuration, formatRelativeTime } from "@/lib/format"
import { useI18n } from "@/lib/i18n"
import { SerialPollingContext, useSerialPolling } from "@/lib/use-serial-polling"
import { cn } from "@/lib/utils"
import { getRuntime, getSettings, listTasks, type Capability, type Runtime, type TaskSummary } from "@/lib/v1-api"
import { STAGE_LABELS, STATUS_LABELS, WAIT_LABELS, isActiveStatus, useV1Text } from "@/lib/v1-ui"
import { BrandMark } from "@/components/brand/brand-mark"
import { StatusBadge } from "@/components/status-badge"
import { TaskComposer, type StudioContext } from "@/components/task-composer"
import { TaskCover } from "@/components/task-cover"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"

const RECENT_LIMIT = 6
const TOOL_NAMES: Record<string, string> = { demucs: "Demucs", whisper: "Whisper", openai: "LLM", voxcpm: "VoxCPM2" }

function SectionHeader({ id, title, count, href, linkLabel }: {
  id?: string
  title: string
  count?: number
  href?: string
  linkLabel?: string
}) {
  return (
    <div className="mb-4 flex items-center justify-between gap-4">
      <h2 id={id} className="flex items-center gap-2.5 text-base font-semibold tracking-tight">
        {title}
        {typeof count === "number" ? (
          <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">
            {count}
          </span>
        ) : null}
      </h2>
      {href && linkLabel ? (
        <Link
          href={href}
          className="group inline-flex items-center gap-1 rounded-md text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          {linkLabel}
          <ChevronRight className="size-4 transition-transform group-hover:translate-x-0.5" />
        </Link>
      ) : null}
    </div>
  )
}

// 首屏下方的处理流程，同时显示每一步在本机是否就绪；不可用时列出后端给出的原因。
function RuntimePipeline({ runtime, loading, onRefresh }: { runtime: Runtime | null; loading: boolean; onRefresh: () => void }) {
  const { t } = useI18n()
  const text = useV1Text()
  const steps: { kind: Capability["capability"]; icon: LucideIcon; label: string }[] = [
    { kind: "separation", icon: AudioWaveform, label: t.studio.featureSeparate },
    { kind: "asr", icon: Mic, label: t.studio.featureAsr },
    { kind: "translation", icon: Languages, label: t.studio.featureTranslate },
    { kind: "tts", icon: Captions, label: t.studio.featureDub },
  ]
  const unavailable = runtime?.capabilities.filter((item) => !item.available && item.capability !== "subtitle_alignment") ?? []
  return (
    <div className="flex flex-col items-center gap-3">
      <ol aria-label={text("Processing pipeline", "处理流程", "処理の流れ")} className="flex flex-wrap items-center justify-center gap-x-2 gap-y-2 text-xs text-subtle-foreground">
        {steps.map((step, index) => {
          const items = runtime?.capabilities.filter((item) => item.capability === step.kind) ?? []
          const ready = items.some((item) => item.available)
          const tool = items[0] ? TOOL_NAMES[items[0].adapter] ?? items[0].adapter : null
          return (
            <li key={step.kind} className="flex items-center gap-2">
              {index > 0 ? <span aria-hidden="true" className="h-px w-5 bg-border sm:w-8" /> : null}
              <span className="inline-flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className={cn("size-1.5 rounded-full", !runtime ? "bg-status-neutral/50" : ready ? "bg-status-success" : "bg-status-warning")}
                />
                <step.icon className="size-3.5" aria-hidden="true" />
                <span className="text-muted-foreground">{step.label}</span>
                {tool ? <span className="hidden font-mono text-[11px] sm:inline">{tool}</span> : null}
                {runtime ? (
                  <span className="sr-only">{ready ? text("Available", "可用", "利用可能") : text("Unavailable", "不可用", "利用不可")}</span>
                ) : null}
              </span>
            </li>
          )
        })}
        <li className="ml-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={onRefresh}
            disabled={loading}
            aria-label={text("Refresh model status", "刷新模型状态", "モデルの状態を更新")}
            title={text("Refresh model status", "刷新模型状态", "モデルの状態を更新")}
          >
            <RefreshCw className={cn(loading && "animate-spin")} />
          </Button>
        </li>
      </ol>
      {unavailable.length ? (
        <ul className="max-w-2xl space-y-1 text-center text-xs leading-relaxed text-status-warning-fg">
          {unavailable.map((item) => (
            <li key={`${item.adapter}-${item.capability}`}>
              <span className="font-mono">{item.adapter}</span>
              <span aria-hidden="true"> · </span>
              <span>{item.unavailable_reason || text("Unavailable", "不可用", "利用不可")}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

function TaskMeta({ task }: { task: TaskSummary }) {
  const duration = formatMediaDuration(task.source_duration_ms)
  return (
    <span className="truncate tabular-nums">
      {duration ? `${duration} · ` : ""}
      {formatBytes(task.source_size_bytes)}
    </span>
  )
}

export default function Home() {
  const { language, t } = useI18n()
  const text = useV1Text()
  const [context, setContext] = useState<StudioContext | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [revision, setRevision] = useState(0)
  const [tasks, setTasks] = useState<TaskSummary[] | null>(null)

  const refreshContext = useCallback(() => {
    setLoading(true)
    setLoadError("")
    setRevision((value) => value + 1)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    Promise.all([getRuntime(controller.signal), getSettings(controller.signal)]).then(([runtime, settings]) => {
      if (controller.signal.aborted) return
      setContext({ runtime, settings })
      setLoading(false)
    }).catch((err) => {
      if (!controller.signal.aborted && !isAbortError(err)) {
        setLoadError(err instanceof Error ? err.message : String(err))
        setLoading(false)
      }
    })
    return () => controller.abort()
  }, [revision])

  const pollTasks = useCallback(async ({ signal, isCurrent }: SerialPollingContext) => {
    try {
      const result = await listTasks({ limit: 12 }, signal)
      if (isCurrent()) setTasks(result.items)
    } catch (err) {
      if (isCurrent() && !isAbortError(err)) setTasks((current) => current ?? [])
    }
  }, [])
  useSerialPolling(pollTasks, context?.runtime.limits.poll_interval_ms ?? 2000)

  const activeTasks = tasks?.filter((task) => isActiveStatus(task.status)) ?? []
  const recentTasks = tasks?.filter((task) => !isActiveStatus(task.status)).slice(0, RECENT_LIMIT) ?? []

  return (
    <>
      {/* 首屏只放创建区：占满视口高度，下方的任务区块滚动后才出现。 */}
      <section className="relative isolate flex min-h-[calc(100dvh-3.5rem)] flex-col justify-center overflow-hidden border-b border-border lg:min-h-dvh">
        <div aria-hidden="true" className="aurora -z-10" />
        <div
          aria-hidden="true"
          className="bg-dot-grid absolute inset-0 -z-10 [mask-image:radial-gradient(ellipse_70%_60%_at_50%_0%,black,transparent)]"
        />
        <div className="mx-auto w-full max-w-4xl px-5 pt-10 pb-12 sm:px-8 lg:pt-14 lg:pb-14 [@media(max-height:820px)]:pt-8 [@media(max-height:820px)]:pb-10">
          <div className="flex animate-rise flex-col items-center text-center">
            <BrandMark animated className="h-10 sm:h-11 [@media(max-height:820px)]:h-9" />
            <span className="mt-6 inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-3 py-1 text-xs font-medium text-muted-foreground backdrop-blur [@media(max-height:820px)]:hidden">
              <Sparkles className="size-3.5 text-brand-pink" />
              {t.studio.heroBadge}
            </span>
            <h1 className="mt-5 text-[34px] leading-[1.12] font-semibold tracking-tight text-balance sm:text-5xl lg:text-[52px] lg:[@media(max-height:820px)]:text-[44px]">
              {t.studio.heroTitleLead}
              {language === "en" ? " " : ""}
              <span className="text-brand-gradient">{t.studio.heroTitleAccent}</span>
            </h1>
            <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-pretty text-muted-foreground sm:text-[17px] [@media(max-height:820px)]:mt-3">
              {t.studio.heroSubtitle}
            </p>
          </div>

          <div className="mt-8 animate-rise [animation-delay:120ms] [@media(max-height:820px)]:mt-6">
            <TaskComposer
              context={context}
              loading={loading}
              loadError={loadError}
              onRetryLoad={refreshContext}
              onSettingsChange={(settings) => setContext((current) => current ? { ...current, settings } : current)}
            />
          </div>

          <div className="mt-6 flex animate-rise flex-col items-center gap-4 [animation-delay:200ms]">
            {activeTasks.length > 0 ? (
              <Link
                href="/tasks"
                className="group inline-flex items-center gap-2 rounded-full border border-status-running/25 bg-status-running/10 px-3.5 py-1.5 text-[13px] font-medium text-status-running-fg transition-colors hover:bg-status-running/15"
              >
                <span className="relative flex size-2" aria-hidden="true">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-status-running opacity-60" />
                  <span className="relative inline-flex size-2 rounded-full bg-status-running" />
                </span>
                <span>
                  {text(
                    `${activeTasks.length} task${activeTasks.length > 1 ? "s" : ""} queued / running`,
                    `${activeTasks.length} 个任务正在排队或处理`,
                    `${activeTasks.length} 件のタスクが待機中または処理中`,
                  )}
                </span>
                <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
              </Link>
            ) : null}
            <RuntimePipeline runtime={context?.runtime ?? null} loading={loading} onRefresh={refreshContext} />
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-6xl space-y-12 px-5 py-10 sm:px-8 lg:py-14">
        {activeTasks.length ? (
          <section aria-labelledby="studio-active">
            <SectionHeader
              id="studio-active"
              title={text("In progress", "进行中", "処理中")}
              count={activeTasks.length}
              href="/tasks"
              linkLabel={text("View all", "查看全部", "すべて表示")}
            />
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {activeTasks.map((task) => {
                const started = task.status !== "queued"
                const progress = started && task.stage_progress !== null ? Math.round(task.stage_progress * 100) : null
                return (
                  <Link
                    key={task.id}
                    href={`/tasks/${task.id}`}
                    className="group flex items-center gap-4 rounded-2xl border border-border bg-card p-3 pr-4 shadow-card transition-[border-color,transform] outline-none hover:-translate-y-px hover:border-input focus-visible:ring-3 focus-visible:ring-ring/40"
                  >
                    <TaskCover id={task.id} size="sm" className="w-24 sm:w-28" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <p className="line-clamp-2 min-w-0 text-sm font-medium break-words text-foreground sm:line-clamp-1">{task.source_name}</p>
                        <StatusBadge status={task.status}>{text(...STATUS_LABELS[task.status])}</StatusBadge>
                      </div>
                      <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-accent">
                        <div
                          className={cn(
                            "relative h-full overflow-hidden rounded-full bg-brand-gradient transition-[width] duration-500",
                            progress === null && "opacity-40",
                          )}
                          style={{ width: `${progress ?? (started ? 100 : 4)}%` }}
                        >
                          {started && progress === null ? <span className="shimmer absolute inset-0" /> : null}
                        </div>
                      </div>
                      <p className="mt-1.5 truncate text-xs text-muted-foreground">
                        {started
                          ? [
                            text(...STAGE_LABELS[task.current_stage]),
                            progress !== null ? `${progress}%` : null,
                            task.wait_reason ? text(...WAIT_LABELS[task.wait_reason]) : null,
                          ].filter(Boolean).join(" · ")
                          : task.wait_reason ? text(...WAIT_LABELS[task.wait_reason]) : t.nav.queuedOnly}
                      </p>
                    </div>
                  </Link>
                )
              })}
            </div>
          </section>
        ) : null}

        <section aria-labelledby="studio-recent">
          <SectionHeader id="studio-recent" title={text("Recent tasks", "最近任务", "最近のタスク")} href="/tasks" linkLabel={text("View all", "查看全部", "すべて表示")} />
          {tasks === null ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
              {[0, 1, 2].map((item) => (
                <div key={item} className="overflow-hidden rounded-2xl border border-border bg-card">
                  <Skeleton className="aspect-video rounded-none" />
                  <div className="space-y-2.5 p-4">
                    <Skeleton className="h-4 w-4/5" />
                    <Skeleton className="h-3 w-2/5" />
                  </div>
                </div>
              ))}
            </div>
          ) : recentTasks.length === 0 ? (
            <div className="flex flex-col items-center rounded-2xl border border-dashed border-border bg-muted px-6 py-14 text-center">
              <BrandMark className="h-8 opacity-60 grayscale" />
              <p className="mt-5 text-sm font-medium text-foreground">{text("No finished tasks yet", "还没有完成的任务", "完了したタスクはまだありません")}</p>
              <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-muted-foreground">
                {text(
                  "Import a local video above — finished tasks will appear here.",
                  "在上方导入本地视频，处理完成的任务会出现在这里。",
                  "上でローカル動画を読み込むと、完了したタスクがここに表示されます。",
                )}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {recentTasks.map((task) => (
                <Link
                  key={task.id}
                  href={`/tasks/${task.id}`}
                  className="group relative flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-card transition-[border-color,box-shadow,transform] duration-200 outline-none hover:-translate-y-0.5 hover:border-input hover:shadow-float focus-visible:ring-3 focus-visible:ring-ring/40"
                >
                  <TaskCover id={task.id} size="md" className="rounded-none ring-0" />
                  <StatusBadge status={task.status} variant="overlay" className="absolute top-3 right-3">
                    {text(...STATUS_LABELS[task.status])}
                  </StatusBadge>
                  <div className="flex flex-1 flex-col gap-3 p-4">
                    <p className="line-clamp-2 text-sm leading-snug font-medium break-words text-foreground">{task.source_name}</p>
                    <div className="mt-auto flex items-center justify-between gap-3 text-xs text-muted-foreground">
                      <TaskMeta task={task} />
                      <time className="shrink-0 tabular-nums" dateTime={task.created_at} title={formatDateTime(task.created_at)}>
                        {formatRelativeTime(task.created_at, language)}
                      </time>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  )
}
