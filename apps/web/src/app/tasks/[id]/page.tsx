"use client"

import { use, useCallback, useState } from "react"
import { CheckCircle2, Circle, CircleMinus, Download } from "lucide-react"
import { AppHeader } from "@/components/app-header"
import { TaskStatusView } from "@/components/v1-task-status"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ApiError, isAbortError } from "@/lib/api"
import { getTask, type OutputKind, type Task } from "@/lib/v1-api"
import { OUTPUT_LABELS, STAGES, STAGE_LABELS, formatBytes, useV1Text } from "@/lib/v1-ui"
import { useSerialPolling, type SerialPollingContext } from "@/lib/use-serial-polling"

const FILE_LABELS: Record<OutputKind, [string, string, string]> = {
  video: ["Video", "成品视频", "完成動画"],
  audio: ["Mixed audio", "最终混音", "ミックス済み音声"],
  source_subtitles: ["Source subtitles", "原文字幕", "原文字幕"],
  translated_subtitles: ["Translated subtitles", "译文字幕", "翻訳字幕"],
}

export default function TaskDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const text = useV1Text()
  const [task, setTask] = useState<Task | null>(null)
  const [error, setError] = useState("")
  const [mediaError, setMediaError] = useState("")
  const pollTask = useCallback(async ({ signal, isCurrent }: SerialPollingContext) => {
    try {
      const next = await getTask(id, signal)
      if (isCurrent()) { setTask(next); setError("") }
    } catch (err) {
      if (isCurrent() && !isAbortError(err)) {
        setError(err instanceof Error ? err.message : String(err))
        if (err instanceof ApiError && err.status === 404) setTask(null)
      }
    }
  }, [id])
  useSerialPolling(pollTask)

  const skipped = task ? STAGES.filter((stage) => (stage === "separate" && !task.config.separation)
    || (task.config.output_mode === "subtitles" && ["tts", "mix"].includes(stage))) : []
  const currentIndex = task ? STAGES.indexOf(task.current_stage as typeof STAGES[number]) : -1

  return <main className="min-h-screen bg-[#f5f7fb] text-foreground">
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6">
      <AppHeader backHref="/" />
      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</p>}
      {!task && !error && <p>{text("Loading task…", "正在读取任务…", "タスクを読み込み中…")}</p>}
      {task && <>
        <div className="space-y-3"><h1 className="break-words text-2xl font-semibold tracking-tight">{task.source_name}</h1>
          <TaskStatusView task={task} />
          <p className="text-sm text-muted-foreground">{task.message}</p>
        </div>
        <ol aria-label={text("Processing steps", "处理流程", "処理手順")} className="grid grid-cols-2 gap-3 rounded-lg border bg-white p-4 sm:grid-cols-4 lg:grid-cols-7">
          {STAGES.map((stage, index) => {
            const skip = skipped.includes(stage)
            const complete = !skip && (task.current_stage === "done" || index < currentIndex)
            const current = stage === task.current_stage
            return <li key={stage} aria-current={current ? "step" : undefined} className={`space-y-2 text-sm ${current ? "font-medium text-sky-800" : "text-muted-foreground"}`}>
              {skip ? <CircleMinus className="size-5" /> : complete ? <CheckCircle2 className="size-5 text-sky-600" /> : <Circle className={`size-5 ${current ? "fill-sky-100" : ""}`} />}
              <p>{text(...STAGE_LABELS[stage])}</p>
              {skip && <p className="text-xs">{text("Skipped", "已跳过", "スキップ")}</p>}
            </li>
          })}
        </ol>
        {task.error && <section role="alert" className="space-y-2 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <p className="font-medium">{task.error.message}</p>
          <p className="break-all font-mono text-xs">{task.error.code}{task.error.field ? ` · ${task.error.field}` : ""}</p>
          {task.error.action === "adjust_settings" && <p>{text("Review the model connection in Settings before creating a new task.", "请在设置中检查模型连接后创建新任务。", "設定でモデルの接続を確認してから新しいタスクを作成してください。")}</p>}
        </section>}
        {task.external_operation.may_still_run && <p className="rounded-lg bg-amber-50 p-4 text-sm text-amber-900">{text("The remote request may still be running. Its final result is unconfirmed.", "远端请求可能仍在执行，最终结果尚未确认。", "外部サービスのリクエストは実行中の可能性があり、最終結果は未確認です。")}</p>}
        <Card><CardHeader><CardTitle><h2>{text("Preview and download", "预览与下载", "プレビューとダウンロード")}</h2></CardTitle></CardHeader>
          <CardContent className="space-y-5">
            {Object.keys(task.outputs).length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">{text("Outputs appear after export completes.", "导出完成后，成品会显示在这里。", "書き出しが完了すると結果が表示されます。")}</p>}
            {task.outputs.video && <video aria-label={text("Video preview", "视频预览", "動画プレビュー")} className="aspect-video w-full rounded-lg bg-black" src={task.outputs.video.url} controls preload="metadata" onError={() => setMediaError(text("Unable to load the video preview. Check the file download.", "视频预览读取失败，请检查成品下载。", "動画プレビューを読み込めません。ファイルのダウンロードを確認してください。"))} />}
            {task.outputs.audio && <div className="space-y-2"><p className="text-sm font-medium">{text("Final soundtrack", "最终音轨", "完成音声")}</p>
              <audio aria-label={text("Audio preview", "音轨试听", "音声プレビュー")} className="w-full" src={task.outputs.audio.url} controls preload="metadata" onError={() => setMediaError(text("Unable to load the audio preview. Check the file download.", "音轨试听读取失败，请检查成品下载。", "音声プレビューを読み込めません。ファイルのダウンロードを確認してください。"))} />
            </div>}
            {mediaError && <p role="alert" className="text-sm text-red-700">{mediaError}</p>}
            <ul className="divide-y">{Object.entries(task.outputs).map(([kind, file]) => <li key={kind} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div><p className="text-sm font-medium">{text(...FILE_LABELS[kind as OutputKind])}</p>
                <p className="break-all text-xs text-muted-foreground">{file.file_name} · {formatBytes(file.size_bytes)}{file.timeline ? ` · ${file.timeline === "source" ? text("Source timeline", "源时间轴", "元のタイムライン") : text("Dubbed timeline", "配音时间轴", "吹き替えタイムライン")}` : ""}</p>
              </div>
              <div className="flex items-center gap-4 text-sm text-sky-800">
                {kind.endsWith("subtitles") && <a href={file.url} target="_blank" rel="noreferrer" className="underline underline-offset-4">{text("View", "查看", "表示")}</a>}
                <a href={`${file.url}?download=true`} download={file.file_name} className="inline-flex items-center gap-1 underline underline-offset-4"><Download className="size-4" />{text("Download", "下载", "ダウンロード")}</a>
              </div>
            </li>)}</ul>
          </CardContent>
        </Card>
        <Card><CardHeader><CardTitle><h2>{text("Task configuration", "本次任务配置", "このタスクの設定")}</h2></CardTitle></CardHeader>
          <CardContent className="space-y-4 text-sm">
            <p className="text-muted-foreground">{text("This snapshot was fixed when the task was created.", "创建任务时固定的配置，修改默认设置不会改变它。", "作成時の設定です。初期設定を変更しても、このタスクには影響しません。")}</p>
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[140px_1fr]">
              <dt className="text-muted-foreground">{text("Languages", "语言", "言語")}</dt><dd>{task.config.source_language} → {task.config.target_language}</dd>
              <dt className="text-muted-foreground">{text("Output", "输出内容", "出力内容")}</dt><dd>{text(...OUTPUT_LABELS[task.config.output_mode])}</dd>
              <dt className="text-muted-foreground">{text("Background audio", "背景音", "背景音")}</dt><dd>{task.config.keep_background ? text("Keep", "保留", "保持") : text("Off", "不保留", "なし")}</dd>
              {(["asr", "translation", "tts", "separation"] as const).filter((kind) => task.config[kind]).map((kind) => <div key={kind} className="contents">
                <dt className="text-muted-foreground">{text(...STAGE_LABELS[kind === "translation" ? "translate" : kind === "separation" ? "separate" : kind])}</dt>
                <dd className="break-words">{task.config[kind]!.adapter} / {task.config[kind]!.model} · {task.config[kind]!.device}</dd>
              </div>)}
              {task.config.tts && <><dt className="text-muted-foreground">{text("Voice", "声音", "音声")}</dt><dd>{task.config.tts.voice.mode === "preset" ? task.config.tts.voice.id : text("Source voice clone", "克隆源音色", "元の声を複製")}</dd></>}
              <dt className="text-muted-foreground">{text("Attempt", "执行次数", "実行回数")}</dt><dd>{task.attempt}</dd>
              <dt className="text-muted-foreground">{text("Created", "创建时间", "作成日時")}</dt><dd>{new Date(task.created_at).toLocaleString()}</dd>
              <dt className="text-muted-foreground">{text("Task ID", "任务 ID", "タスク ID")}</dt><dd className="break-all font-mono text-xs">{task.id}</dd>
            </dl>
          </CardContent>
        </Card>
      </>}
    </div>
  </main>
}
