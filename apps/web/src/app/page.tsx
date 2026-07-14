"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react"
import { ChevronLeft, ChevronRight, Play, Search, Upload } from "lucide-react"

import {
  ExecutionMode,
  LocalDirection,
  TaskListExecutionMode,
  TaskListResponse,
  TaskListSort,
  TaskListStatus,
  TaskSummary,
  createTask,
  listTasks,
  uploadLocalTask,
} from "@/lib/api"
import { useI18n } from "@/lib/i18n"
import { statusBadgeClass } from "@/lib/status"
import { AppHeader } from "@/components/app-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select"

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100]

function isActive(status: string) {
  return status === "queued" || status === "running"
}

function isAwaitingAction(status: string) {
  return status === "paused"
}

function formatTime(value: string | null) {
  if (!value) return ""
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

function shortUrl(url: string) {
  return url.replace(/^https?:\/\/(www\.)?/, "")
}

function activeCount(tasks: TaskSummary[]) {
  return tasks.filter((t) => isActive(t.status)).length
}

function selectedLabel<T extends string>(options: { value: T; label: string }[], value: T) {
  return options.find((option) => option.value === value)?.label || value
}

function pageRangeText(language: string, start: number, end: number, total: number) {
  if (language === "zh") return `显示 ${start}-${end} / 共 ${total} 个任务`
  return `Showing ${start}-${end} of ${total} tasks`
}

function pageIndexText(language: string, page: number, totalPages: number) {
  if (language === "zh") return `第 ${page} / ${totalPages} 页`
  return `Page ${page} / ${totalPages}`
}

export default function Home() {
  const router = useRouter()
  const { activeTasksText, language, stageLabel, statusLabel, t } = useI18n()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const subtitleInputRef = useRef<HTMLInputElement>(null)
  const [youtubeUrl, setYoutubeUrl] = useState("")
  const [bilibiliUrl, setBilibiliUrl] = useState("")
  const [localFile, setLocalFile] = useState<File | null>(null)
  const [localSubtitleFile, setLocalSubtitleFile] = useState<File | null>(null)
  const [localDirection, setLocalDirection] = useState<LocalDirection>("en-zh")
  const [executionMode, setExecutionMode] = useState<ExecutionMode>("auto")
  const [tasks, setTasks] = useState<TaskSummary[]>([])
  const [taskTotal, setTaskTotal] = useState(0)
  const [taskPage, setTaskPage] = useState(1)
  const [taskPageSize, setTaskPageSize] = useState(20)
  const [taskQuery, setTaskQuery] = useState("")
  const [taskStatus, setTaskStatus] = useState<TaskListStatus>("all")
  const [taskExecutionMode, setTaskExecutionMode] = useState<TaskListExecutionMode>("all")
  const [taskSort, setTaskSort] = useState<TaskListSort>("created_desc")
  const [error, setError] = useState("")
  const [submitting, setSubmitting] = useState(false)

  const localDirectionOptions: { value: LocalDirection; label: string }[] = [
    { value: "en-zh", label: t.home.localEnZh },
    { value: "zh-en", label: t.home.localZhEn },
  ]

  const executionModeOptions: { value: ExecutionMode; label: string }[] = [
    { value: "auto", label: t.home.executionAuto },
    { value: "manual", label: t.home.executionManual },
  ]

  const statusOptions: { value: TaskListStatus; label: string }[] = [
    { value: "all", label: t.home.allStatuses },
    { value: "queued", label: statusLabel("queued") },
    { value: "running", label: statusLabel("running") },
    { value: "paused", label: statusLabel("paused") },
    { value: "succeeded", label: statusLabel("succeeded") },
    { value: "failed", label: statusLabel("failed") },
  ]

  const modeOptions: { value: TaskListExecutionMode; label: string }[] = [
    { value: "all", label: t.home.allModes },
    { value: "auto", label: t.home.modeAuto },
    { value: "manual", label: t.home.modeManual },
  ]

  const sortOptions: { value: TaskListSort; label: string }[] = [
    { value: "created_desc", label: t.home.sortCreatedDesc },
    { value: "created_asc", label: t.home.sortCreatedAsc },
    { value: "started_desc", label: t.home.sortStartedDesc },
    { value: "started_asc", label: t.home.sortStartedAsc },
    { value: "completed_desc", label: t.home.sortCompletedDesc },
    { value: "completed_asc", label: t.home.sortCompletedAsc },
    { value: "status_asc", label: t.home.sortStatusAsc },
    { value: "status_desc", label: t.home.sortStatusDesc },
    { value: "title_asc", label: t.home.sortTitleAsc },
    { value: "title_desc", label: t.home.sortTitleDesc },
  ]

  function applyTaskList(result: TaskListResponse) {
    const lastPage = Math.max(1, Math.ceil(result.total / result.page_size))
    setTaskTotal(result.total)
    if (result.total > 0 && result.tasks.length === 0 && result.page > lastPage) {
      setTasks([])
      setTaskPage(lastPage)
      return
    }
    setTasks(result.tasks)
  }

  async function refreshTasks() {
    const result = await listTasks({
      page: taskPage,
      page_size: taskPageSize,
      q: taskQuery,
      status: taskStatus,
      execution_mode: taskExecutionMode,
      sort: taskSort,
    })
    applyTaskList(result)
  }

  useEffect(() => {
    let cancelled = false

    const loadTasks = async () => {
      try {
        const result = await listTasks({
          page: taskPage,
          page_size: taskPageSize,
          q: taskQuery,
          status: taskStatus,
          execution_mode: taskExecutionMode,
          sort: taskSort,
        })
        if (!cancelled) applyTaskList(result)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : t.home.loadError)
      }
    }

    loadTasks()
    const interval = window.setInterval(loadTasks, 2000)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [taskExecutionMode, taskPage, taskPageSize, taskQuery, taskSort, taskStatus, t.home.loadError])

  function resetTaskPage() {
    setTaskPage(1)
  }

  function selectLocalFile(event: ChangeEvent<HTMLInputElement>) {
    setError("")
    setLocalFile(event.target.files?.[0] || null)
    setLocalSubtitleFile(null)
    if (subtitleInputRef.current) {
      subtitleInputRef.current.value = ""
    }
  }

  function selectLocalSubtitleFile(event: ChangeEvent<HTMLInputElement>) {
    setError("")
    setLocalSubtitleFile(event.target.files?.[0] || null)
  }

  async function submitTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError("")
    const submittedUrl = youtubeUrl.trim() || bilibiliUrl.trim()
    if (!submittedUrl && !localFile) return
    setSubmitting(true)
    try {
      const created = localFile
        ? await uploadLocalTask(localFile, localDirection, localSubtitleFile, executionMode)
        : await createTask(submittedUrl, executionMode)
      setYoutubeUrl("")
      setBilibiliUrl("")
      setLocalFile(null)
      setLocalSubtitleFile(null)
      if (fileInputRef.current) {
        fileInputRef.current.value = ""
      }
      if (subtitleInputRef.current) {
        subtitleInputRef.current.value = ""
      }
      refreshTasks().catch(() => undefined)
      router.push(`/tasks/${created.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : t.home.createError)
    } finally {
      setSubmitting(false)
    }
  }

  const queued = activeCount(tasks)
  const hasUrl = Boolean(youtubeUrl.trim() || bilibiliUrl.trim())
  const hasLocalFile = Boolean(localFile)
  const canSubmit = Boolean((hasUrl || hasLocalFile) && !submitting)
  const totalPages = Math.max(1, Math.ceil(taskTotal / taskPageSize))
  const displayPage = Math.min(taskPage, totalPages)
  const pageStart = taskTotal === 0 ? 0 : (displayPage - 1) * taskPageSize + 1
  const pageEnd = Math.min(taskTotal, displayPage * taskPageSize)
  const hasTaskFilters = Boolean(taskQuery.trim()) || taskStatus !== "all" || taskExecutionMode !== "all"

  return (
    <main className="min-h-screen bg-[linear-gradient(135deg,#fff5f5_0%,#f2fbff_48%,#fff4fa_100%)] text-foreground">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <AppHeader />

        <Card>
          <CardHeader>
            <CardTitle>{t.home.createTitle}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={submitTask} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="youtube-url">{t.home.youtubeLabel}</Label>
                <Input
                  id="youtube-url"
                  value={youtubeUrl}
                  onChange={(event) => setYoutubeUrl(event.target.value)}
                  placeholder="https://www.youtube.com/watch?v=..."
                  disabled={Boolean(bilibiliUrl.trim()) || hasLocalFile}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="bilibili-url">{t.home.bilibiliLabel}</Label>
                <Input
                  id="bilibili-url"
                  value={bilibiliUrl}
                  onChange={(event) => setBilibiliUrl(event.target.value)}
                  placeholder="https://www.bilibili.com/video/BV..."
                  disabled={Boolean(youtubeUrl.trim()) || hasLocalFile}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
                <div className="space-y-2">
                  <Label htmlFor="local-video">{t.home.localVideoLabel}</Label>
                  <Input
                    ref={fileInputRef}
                    id="local-video"
                    type="file"
                    accept="video/*,.mp4,.mov,.m4v,.mkv,.webm,.avi,.flv,.wmv"
                    onChange={selectLocalFile}
                    disabled={hasUrl}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="local-direction">{t.home.localDirectionLabel}</Label>
                  <Select
                    value={localDirection}
                    onValueChange={(value) => setLocalDirection(value as LocalDirection)}
                    disabled={hasUrl}
                  >
                    <SelectTrigger id="local-direction" className="h-10">
                      <span className="min-w-0 truncate text-left">
                        {selectedLabel(localDirectionOptions, localDirection)}
                      </span>
                    </SelectTrigger>
                    <SelectContent>
                      {localDirectionOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="local-subtitle">{t.home.localSubtitleLabel}</Label>
                <Input
                  ref={subtitleInputRef}
                  id="local-subtitle"
                  type="file"
                  accept=".srt"
                  onChange={selectLocalSubtitleFile}
                  disabled={hasUrl || !hasLocalFile}
                />
                <p className="text-xs text-muted-foreground">
                  {t.home.localSubtitleHelp}
                </p>
                {localFile ? (
                  <div
                    data-testid="local-upload-selection"
                    className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground"
                    aria-live="polite"
                  >
                    <p>
                      {t.home.currentLocalVideo}: <span className="font-medium text-foreground">{localFile.name}</span>
                    </p>
                    <p>
                      {t.home.subtitleForCurrentVideo}:{" "}
                      <span className="font-medium text-foreground">
                        {localSubtitleFile?.name || t.home.noSubtitleSelected}
                      </span>
                    </p>
                  </div>
                ) : null}
              </div>
              <div className="space-y-2">
                <Label htmlFor="execution-mode">{t.home.executionModeLabel}</Label>
                <Select
                  value={executionMode}
                  onValueChange={(value) => setExecutionMode(value as ExecutionMode)}
                >
                  <SelectTrigger id="execution-mode" className="h-10">
                    <span className="min-w-0 truncate text-left">
                      {selectedLabel(executionModeOptions, executionMode)}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    {executionModeOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center justify-between gap-3">
                {queued > 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {activeTasksText(queued)}
                  </p>
                ) : (
                  <span />
                )}
                <Button type="submit" disabled={!canSubmit}>
                  {hasLocalFile ? <Upload className="size-4" /> : <Play className="size-4" />}
                  {submitting ? t.home.submitting : t.home.createTask}
                </Button>
              </div>
            </form>

            {error ? (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t.home.taskHistory} ({taskTotal})</CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            <div className="border-b border-border/60 px-4 pb-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_140px_140px_180px_120px]">
                <div className="relative sm:col-span-2 lg:col-span-1">
                  <Label htmlFor="task-search" className="sr-only">
                    {t.home.taskSearchPlaceholder}
                  </Label>
                  <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                  <Input
                    id="task-search"
                    className="h-9 pl-8"
                    value={taskQuery}
                    onChange={(event) => {
                      setTaskQuery(event.target.value)
                      resetTaskPage()
                    }}
                    placeholder={t.home.taskSearchPlaceholder}
                  />
                </div>

                <div>
                  <Label htmlFor="task-status-filter" className="sr-only">
                    {t.home.taskStatusFilter}
                  </Label>
                  <Select
                    value={taskStatus}
                    onValueChange={(value) => {
                      setTaskStatus(value as TaskListStatus)
                      resetTaskPage()
                    }}
                  >
                    <SelectTrigger id="task-status-filter" className="h-9">
                      <span className="min-w-0 truncate text-left">
                        {selectedLabel(statusOptions, taskStatus)}
                      </span>
                    </SelectTrigger>
                    <SelectContent>
                      {statusOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label htmlFor="task-mode-filter" className="sr-only">
                    {t.home.taskModeFilter}
                  </Label>
                  <Select
                    value={taskExecutionMode}
                    onValueChange={(value) => {
                      setTaskExecutionMode(value as TaskListExecutionMode)
                      resetTaskPage()
                    }}
                  >
                    <SelectTrigger id="task-mode-filter" className="h-9">
                      <span className="min-w-0 truncate text-left">
                        {selectedLabel(modeOptions, taskExecutionMode)}
                      </span>
                    </SelectTrigger>
                    <SelectContent>
                      {modeOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label htmlFor="task-sort" className="sr-only">
                    {t.home.taskSort}
                  </Label>
                  <Select
                    value={taskSort}
                    onValueChange={(value) => {
                      setTaskSort(value as TaskListSort)
                      resetTaskPage()
                    }}
                  >
                    <SelectTrigger id="task-sort" className="h-9">
                      <span className="min-w-0 truncate text-left">
                        {selectedLabel(sortOptions, taskSort)}
                      </span>
                    </SelectTrigger>
                    <SelectContent>
                      {sortOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label htmlFor="task-page-size" className="sr-only">
                    {t.home.taskPageSize}
                  </Label>
                  <Select
                    value={String(taskPageSize)}
                    onValueChange={(value) => {
                      setTaskPageSize(Number(value))
                      resetTaskPage()
                    }}
                  >
                    <SelectTrigger id="task-page-size" className="h-9">
                      <span className="min-w-0 truncate text-left">
                        {taskPageSize}
                      </span>
                    </SelectTrigger>
                    <SelectContent>
                      {PAGE_SIZE_OPTIONS.map((option) => (
                        <SelectItem key={option} value={String(option)}>
                          {option}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            {tasks.length === 0 ? (
              <div className="px-6 py-12 text-center text-sm text-muted-foreground">
                {hasTaskFilters ? t.home.noMatchingTasks : t.home.empty}
              </div>
            ) : (
              <ScrollArea className="max-h-[56dvh] overflow-hidden">
                <ul className="flex flex-col">
                  {tasks.map((item) => (
                    <li key={item.id} className="border-b border-border/60 last:border-b-0">
                      <Link
                        href={`/tasks/${item.id}`}
                        className="flex w-full items-center gap-3 px-6 py-3 text-sm transition-colors hover:bg-muted/60"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-left font-medium text-zinc-900">
                            {item.title || shortUrl(item.url)}
                          </p>
                          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                            <Badge className={statusBadgeClass(item.status)}>{statusLabel(item.status)}</Badge>
                            <span>{formatTime(item.created_at)}</span>
                            {isActive(item.status) && item.current_stage ? (
                              <span>· {stageLabel(item.current_stage)}</span>
                            ) : null}
                            {isAwaitingAction(item.status) ? (
                              <span>· {t.status.paused}</span>
                            ) : null}
                          </div>
                        </div>
                        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </ScrollArea>
            )}

            {taskTotal > 0 ? (
              <div className="flex flex-col gap-3 border-t border-border/60 px-4 py-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
                <span>{pageRangeText(language, pageStart, pageEnd, taskTotal)}</span>
                <div className="flex items-center justify-between gap-3 sm:justify-end">
                  <span>{pageIndexText(language, displayPage, totalPages)}</span>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setTaskPage((page) => Math.max(1, page - 1))}
                      disabled={displayPage <= 1}
                    >
                      <ChevronLeft className="size-4" />
                      {t.home.previousPage}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setTaskPage((page) => Math.min(totalPages, page + 1))}
                      disabled={displayPage >= totalPages}
                    >
                      {t.home.nextPage}
                      <ChevronRight className="size-4" />
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
