"use client"

import { useCallback, useState } from "react"
import { Download } from "lucide-react"
import { InlineAlert } from "@/components/inline-alert"
import { isAbortError } from "@/lib/api"
import { getTaskLog, getTaskLogUrl } from "@/lib/v1-api"
import { useSerialPolling, type SerialPollingContext } from "@/lib/use-serial-polling"
import { useV1Text } from "@/lib/v1-ui"

export function TaskLog({ id }: { id: string }) {
  const text = useV1Text()
  const [log, setLog] = useState<string | null>(null)
  const [error, setError] = useState("")
  const poll = useCallback(async ({ signal, isCurrent }: SerialPollingContext) => {
    try {
      const next = await getTaskLog(id, { lines: 200 }, signal)
      if (isCurrent()) { setLog(next); setError("") }
    } catch (err) {
      if (isCurrent() && !isAbortError(err)) setError(err instanceof Error ? err.message : String(err))
    }
  }, [id])
  useSerialPolling(poll)
  return <div className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground"><p>{text("Latest 200 lines · refreshes automatically", "最近 200 行 · 自动刷新", "最新 200 行 · 自動更新")}</p>
      <a href={getTaskLogUrl(id, { download: true })} download className="inline-flex items-center gap-1.5 rounded text-[13px] font-medium text-link outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/40"><Download className="size-3.5" />{text("Download full log", "下载完整日志", "全ログをダウンロード")}</a>
    </div>
    {error && <InlineAlert>{error}</InlineAlert>}
    <pre aria-label={text("Task log", "任务日志", "タスクログ")} className="max-h-96 overflow-auto rounded-xl border border-border bg-[#0b0b10] p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words text-white/80">{log ?? text("Loading log…", "正在读取日志…", "ログを読み込み中…")}{log === "" && text("No log entries yet.", "暂无日志。", "ログはまだありません。")}</pre>
  </div>
}
