"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { FormEvent, useCallback, useEffect, useState } from "react"
import { ChevronLeft, ChevronRight, RefreshCw, Upload } from "lucide-react"
import { AppHeader } from "@/components/app-header"
import { TaskConfigForm, configProblem, initialTaskConfig } from "@/components/v1-task-config"
import { TaskStatusView } from "@/components/v1-task-status"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { ApiError, isAbortError } from "@/lib/api"
import { useI18n } from "@/lib/i18n"
import { createTask, deleteTask, getRuntime, getSettings, getTask, listTasks, patchSettings, type Runtime, type Settings, type TaskConfig, type TaskList, type TaskStatus } from "@/lib/v1-api"
import { STATUS_LABELS, formatBytes, selectClass, useV1Text } from "@/lib/v1-ui"
import { useSerialPolling, type SerialPollingContext } from "@/lib/use-serial-polling"

type Context = { runtime: Runtime; settings: Settings }
type UploadRequest = { id: string; file: File; config: TaskConfig }
const PAGE_SIZE = 20

export default function Home() {
  const router = useRouter()
  const text = useV1Text()
  const { setLanguage } = useI18n()
  const [context, setContext] = useState<Context | null>(null)
  const [config, setConfig] = useState<TaskConfig | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [revision, setRevision] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [uploadError, setUploadError] = useState("")
  const [upload, setUpload] = useState<UploadRequest | null>(null)
  const [failedUploadId, setFailedUploadId] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [savingDefaults, setSavingDefaults] = useState(false)
  const [savedMessage, setSavedMessage] = useState("")
  const [tasks, setTasks] = useState<TaskList | null>(null)
  const [listError, setListError] = useState("")
  const [filter, setFilter] = useState<"all" | "active" | TaskStatus>("all")
  const [offset, setOffset] = useState(0)

  const refreshSettings = useCallback(() => {
    setLoading(true)
    setLoadError("")
    setRevision((value) => value + 1)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    Promise.all([getRuntime(controller.signal), getSettings(controller.signal)]).then(([runtime, settings]) => {
      if (controller.signal.aborted) return
      setContext({ runtime, settings })
      setConfig((current) => current ?? initialTaskConfig(runtime, settings))
      setLanguage(settings.ui_language)
      setLoading(false)
    }).catch((err) => {
      if (!controller.signal.aborted && !isAbortError(err)) {
        setLoadError(err instanceof Error ? err.message : String(err))
        setLoading(false)
      }
    })
    return () => controller.abort()
  }, [revision, setLanguage])

  const pollTasks = useCallback(async ({ signal, isCurrent }: SerialPollingContext) => {
    try {
      const result = await listTasks({ limit: PAGE_SIZE, offset, ...(filter === "active" ? { active: true } : filter === "all" ? {} : { status: filter }) }, signal)
      if (isCurrent()) { setTasks(result); setListError("") }
    } catch (err) {
      if (isCurrent() && !isAbortError(err)) setListError(err instanceof Error ? err.message : String(err))
    }
  }, [filter, offset])
  useSerialPolling(pollTasks, context?.runtime.limits.poll_interval_ms ?? 2000)

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
      const settings = await patchSettings({ defaults: config })
      setContext((current) => current ? { ...current, settings } : current)
      setSavedMessage(text("Saved for new tasks. Existing tasks keep their configuration.", "已保存为新任务默认值，已有任务配置保持不变。", "新しいタスクの初期設定を保存しました。既存のタスクには影響しません。"))
    } catch (err) { setUploadError(err instanceof Error ? err.message : String(err)) }
    finally { setSavingDefaults(false) }
  }

  const problem = context && config ? configProblem(config, context.runtime, context.settings, text) : null
  const busy = submitting || savingDefaults || loading
  return <main className="min-h-screen bg-[#f5f7fb] text-foreground">
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6">
      <AppHeader onSettingsSaved={refreshSettings} />
      <div className="space-y-2"><h1 className="text-2xl font-semibold tracking-tight">{text("Translate your video", "视频语言工作台", "動画を翻訳する")}</h1>
        <p className="text-sm text-muted-foreground">{text("Import a video, choose subtitles or dubbing, then preview and download the result.", "导入视频，选择字幕或配音，完成后预览和下载。", "動画を読み込み、字幕や吹き替えを選び、完成した結果をプレビューしてダウンロードできます。")}</p>
      </div>
      <section aria-label={text("Available models", "模型可用性", "モデルの利用状況")} className="rounded-lg border bg-white p-4">
        <div className="flex items-center justify-between gap-3"><h2 className="font-medium">{text("Available models", "模型可用性", "モデルの利用状況")}</h2>
          <Button variant="ghost" size="sm" onClick={refreshSettings} disabled={busy || !!upload}><RefreshCw className="size-4" />{text("Refresh", "刷新", "更新")}</Button>
        </div>
        {loadError && <p role="alert" className="mt-3 text-red-700">{loadError}</p>}
        {loading && <p className="mt-3 text-sm text-muted-foreground">{text("Checking this device…", "正在读取运行环境…", "実行環境を確認中…")}</p>}
        {context && <ul className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          {context.runtime.capabilities.map((item) => <li key={`${item.adapter}-${item.capability}`} className="flex items-start gap-2">
            <span aria-hidden="true" className={`mt-1.5 size-2 shrink-0 rounded-full ${item.available ? "bg-sky-500" : "bg-amber-500"}`} />
            <span><span className="font-medium">{item.adapter}</span> · {item.available ? text("Available", "可用", "利用可能") : item.unavailable_reason || text("Unavailable", "不可用", "利用不可")}</span>
          </li>)}
        </ul>}
      </section>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <Card><CardHeader><CardTitle><h2>{text("New task", "新建任务", "新規タスク")}</h2></CardTitle></CardHeader>
          <CardContent>
            {!context || !config ? <p className="text-muted-foreground">{text("Load the available models before creating a task.", "读取模型能力后即可配置任务。", "モデルの利用状況を読み込むとタスクを設定できます。")}</p> : <form onSubmit={submit} className="space-y-5">
              <fieldset disabled={busy || !!upload || !!loadError} className="space-y-5 disabled:opacity-70">
                <div className="space-y-2 rounded-lg border border-dashed border-sky-300 bg-sky-50/50 p-4">
                  <Label htmlFor="local-video"><Upload className="size-4" />{text("Local video", "本地视频", "ローカル動画")}</Label>
                  <input id="local-video" type="file" accept={context.runtime.limits.video_suffixes.join(",")} className="w-full text-sm file:mr-3 file:rounded file:border-0 file:bg-white file:px-3 file:py-2" onChange={(event) => {
                    const next = event.target.files?.[0] ?? null
                    setUploadError(""); setFile(null)
                    if (next && next.size > context.runtime.limits.max_file_bytes) setUploadError(text("Video exceeds the upload limit.", "视频超过上传大小限制。", "動画がアップロード上限を超えています。"))
                    else if (next && !context.runtime.limits.video_suffixes.some((suffix) => next.name.toLowerCase().endsWith(suffix.toLowerCase()))) setUploadError(text("Unsupported video format.", "不支持该视频格式。", "対応していない動画形式です。"))
                    else setFile(next)
                  }} />
                  <p className="text-xs text-muted-foreground">{context.runtime.limits.video_suffixes.join(" / ")} · {text("Up to", "最大", "上限")} {formatBytes(context.runtime.limits.max_file_bytes)} · {context.runtime.limits.max_video_duration_ms / 60000} {text("min", "分钟", "分")}</p>
                  {file && <p className="break-all text-sm">{file.name} · {formatBytes(file.size)}</p>}
                </div>
                <TaskConfigForm value={config} runtime={context.runtime} onChange={(next) => { setConfig(next); setSavedMessage(""); setUploadError("") }} />
              </fieldset>
              {problem && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{problem}</p>}
              {uploadError && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{uploadError}</p>}
              {savedMessage && <p role="status" className="text-sm text-sky-800">{savedMessage}</p>}
              {failedUploadId && <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
                <p>{text("The upload was rejected. You can adjust the file or configuration; clear this failed upload before submitting again.", "本次上传失败。可修改文件或配置，清理本次上传后再提交。", "アップロードに失敗しました。ファイルや設定を変更し、失敗したアップロードを削除してから再送信してください。")}</p>
                <code className="block break-all text-xs">{failedUploadId}</code>
                <Button type="button" variant="outline" disabled={submitting} onClick={clearFailedUpload}>{text("Clear failed upload", "清理本次失败上传", "失敗したアップロードを削除")}</Button>
              </div>}
              {upload && !submitting && <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
                <p>{text("The upload result is unconfirmed. Check this task before starting another upload.", "上传结果尚未确认，请先查询原任务。", "アップロード結果を確認できていません。元のタスクを確認してください。")}</p>
                <code className="block break-all text-xs">{upload.id}</code>
                <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" onClick={checkUpload}>{text("Check original task", "查询原任务", "元のタスクを確認")}</Button>
                  <Button type="button" variant="outline" onClick={() => void sendUpload(upload)}>{text("Resend with the same ID", "使用同一 ID 重新上传", "同じ ID で再送信")}</Button>
                </div>
              </div>}
              <div className="flex flex-wrap gap-3">
                <Button type="submit" disabled={!file || !!problem || busy || !!upload || !!failedUploadId || !!loadError}>{submitting ? text("Working…", "处理中…", "処理中…") : text("Create task", "创建任务", "タスクを作成")}</Button>
                <Button type="button" variant="outline" disabled={!!problem || busy || !!upload || !!loadError} onClick={saveDefaults}>{text("Save as defaults", "保存为默认配置", "初期設定として保存")}</Button>
              </div>
            </form>}
          </CardContent>
        </Card>
        <Card><CardHeader><CardTitle><h2>{text("Tasks", "任务记录", "タスク履歴")}</h2></CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5"><Label htmlFor="task-filter">{text("Status", "任务状态", "状態")}</Label>
              <select id="task-filter" className={selectClass} value={filter} onChange={(event) => { setFilter(event.target.value as typeof filter); setOffset(0); setTasks(null) }}>
                <option value="all">{text("All tasks", "全部任务", "すべて")}</option>
                <option value="active">{text("Active tasks", "进行中的任务", "進行中")}</option>
                {Object.entries(STATUS_LABELS).map(([status, label]) => <option key={status} value={status}>{text(...label)}</option>)}
              </select>
            </div>
            {listError && <p role="alert" className="text-sm text-red-700">{listError}</p>}
            {!tasks && !listError && <p className="text-sm text-muted-foreground">{text("Loading tasks…", "正在读取任务…", "タスクを読み込み中…")}</p>}
            {tasks?.items.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">{text("No tasks in this view.", "暂无符合条件的任务。", "該当するタスクはありません。")}</p>}
            <ul className="divide-y">{tasks?.items.map((task) => <li key={task.id} className="space-y-2 py-4 first:pt-0">
              <Link href={`/tasks/${task.id}`} className="block truncate font-medium text-sky-800 underline-offset-4 hover:underline" title={task.source_name}>{task.source_name}</Link>
              <TaskStatusView task={task} />
              <p className="text-xs text-muted-foreground">{new Date(task.created_at).toLocaleString()} · {formatBytes(task.source_size_bytes)}</p>
              {task.error && <p className="text-xs text-red-700">{task.error.message}</p>}
            </li>)}</ul>
            <div className="flex items-center justify-between border-t pt-3">
              <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => { setOffset((value) => Math.max(0, value - PAGE_SIZE)); setTasks(null) }}><ChevronLeft className="size-4" />{text("Previous", "上一页", "前へ")}</Button>
              <span className="text-xs text-muted-foreground">{offset / PAGE_SIZE + 1}</span>
              <Button variant="outline" size="sm" disabled={!tasks?.has_more} onClick={() => { setOffset((value) => value + PAGE_SIZE); setTasks(null) }}>{text("Next", "下一页", "次へ")}<ChevronRight className="size-4" /></Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  </main>
}
