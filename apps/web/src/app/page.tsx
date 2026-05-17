"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { FormEvent, useCallback, useEffect, useState } from "react"
import { ChevronRight, Play } from "lucide-react"

import {
  TaskSummary,
  createTask,
  listTasks,
} from "@/lib/api"
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

function isActive(status: string) {
  return status === "queued" || status === "running"
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

export default function Home() {
  const router = useRouter()
  const [youtubeUrl, setYoutubeUrl] = useState("")
  const [bilibiliUrl, setBilibiliUrl] = useState("")
  const [tasks, setTasks] = useState<TaskSummary[]>([])
  const [error, setError] = useState("")
  const [submitting, setSubmitting] = useState(false)

  const refreshTasks = useCallback(async () => {
    const { tasks: list } = await listTasks()
    setTasks(list)
  }, [])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const { tasks: list } = await listTasks()
        if (cancelled) return
        setTasks(list)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load tasks")
      }
    }
    load()
    const interval = window.setInterval(load, 2000)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [])

  async function submitTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError("")
    const submittedUrl = youtubeUrl.trim() || bilibiliUrl.trim()
    if (!submittedUrl) return
    setSubmitting(true)
    try {
      const created = await createTask(submittedUrl)
      setYoutubeUrl("")
      setBilibiliUrl("")
      refreshTasks().catch(() => undefined)
      router.push(`/tasks/${created.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create task")
    } finally {
      setSubmitting(false)
    }
  }

  const queued = activeCount(tasks)
  const canSubmit = Boolean((youtubeUrl.trim() || bilibiliUrl.trim()) && !submitting)

  return (
    <main className="min-h-screen bg-[linear-gradient(135deg,#fff5f5_0%,#f2fbff_48%,#fff4fa_100%)] text-foreground">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <AppHeader />

        <Card>
          <CardHeader>
            <CardTitle>Create new task</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={submitTask} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="youtube-url">YouTube URL (English → Chinese)</Label>
                <Input
                  id="youtube-url"
                  value={youtubeUrl}
                  onChange={(event) => setYoutubeUrl(event.target.value)}
                  placeholder="https://www.youtube.com/watch?v=..."
                  disabled={Boolean(bilibiliUrl.trim())}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="bilibili-url">Bilibili URL (Chinese → English)</Label>
                <Input
                  id="bilibili-url"
                  value={bilibiliUrl}
                  onChange={(event) => setBilibiliUrl(event.target.value)}
                  placeholder="https://www.bilibili.com/video/BV..."
                  disabled={Boolean(youtubeUrl.trim())}
                />
              </div>
              <div className="flex items-center justify-between gap-3">
                {queued > 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {queued} task{queued > 1 ? "s" : ""} queued / running
                  </p>
                ) : (
                  <span />
                )}
                <Button type="submit" disabled={!canSubmit}>
                  <Play className="size-4" />
                  {submitting ? "Submitting" : "Create task"}
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
            <CardTitle>Task history ({tasks.length})</CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            {tasks.length === 0 ? (
              <div className="px-6 py-12 text-center text-sm text-muted-foreground">
                No tasks yet. Submit a YouTube or Bilibili URL above to start.
              </div>
            ) : (
              <ScrollArea className="max-h-[70dvh]">
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
                          <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                            <Badge className={statusBadgeClass(item.status)}>{item.status}</Badge>
                            <span>{formatTime(item.created_at)}</span>
                            {isActive(item.status) && item.current_stage ? (
                              <span>· {item.current_stage}</span>
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
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
