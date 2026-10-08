"use client"

import Link from "next/link"
import { useCallback, useRef, useState } from "react"
import { ChevronLeft, ChevronRight, Ellipsis, Inbox, Loader2, Plus, SearchX, Trash2 } from "lucide-react"

import { ApiError, isAbortError } from "@/lib/api"
import { formatBytes, formatDateTime, formatMediaDuration, formatRelativeTime } from "@/lib/format"
import { useI18n } from "@/lib/i18n"
import { SerialPollingContext, useSerialPolling } from "@/lib/use-serial-polling"
import { cn } from "@/lib/utils"
import { deleteTask, listTasks, type TaskListParams, type TaskStatus, type TaskSummary } from "@/lib/v1-api"
import { STAGE_LABELS, STATUS_LABELS, WAIT_LABELS, isActiveStatus, useV1Text } from "@/lib/v1-ui"
import { InlineAlert } from "@/components/inline-alert"
import { PageHeader } from "@/components/page-header"
import { StatusBadge } from "@/components/status-badge"
import { TaskCover } from "@/components/task-cover"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLinkItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/menu"
import { Skeleton } from "@/components/ui/skeleton"

const PAGE_SIZE = 10
// “选择所有页”时逐页拉取任务，与 v1 列表接口的 limit 上限一致。
const SELECT_ALL_PAGE_SIZE = 100
const ROW_GRID = "md:grid-cols-[auto_minmax(0,1fr)_minmax(0,148px)_104px]"

type Filter = "all" | "active" | Extract<TaskStatus, "succeeded" | "failed" | "cancelled">

function filterParams(filter: Filter): TaskListParams {
  if (filter === "all") return {}
  if (filter === "active") return { active: true }
  return { status: filter }
}

function canDelete(task: TaskSummary) {
  return task.allowed_actions.includes("delete")
}

export default function TasksPage() {
  const { language, t } = useI18n()
  const text = useV1Text()
  const [filter, setFilter] = useState<Filter>("all")
  const [offset, setOffset] = useState(0)
  const [tasks, setTasks] = useState<TaskSummary[] | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [listError, setListError] = useState("")
  // 选择跨页保留，切换筛选时清空。
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  // 通过“选择所有页”选中了当前筛选下的全部可删除任务；skipped 为仍在进行、不能删除的数量。
  const [allMatching, setAllMatching] = useState<{ skipped: number } | null>(null)
  const [selectingAll, setSelectingAll] = useState(false)
  const filterVersionRef = useRef(0)
  // null：未打开；数组：待确认删除的任务 ID（单条或批量）。
  const [pendingDeleteIds, setPendingDeleteIds] = useState<string[] | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteProgress, setDeleteProgress] = useState({ done: 0, total: 0 })
  const [deleteError, setDeleteError] = useState("")

  const filterOptions: { value: Filter; label: string }[] = [
    { value: "all", label: text("All", "全部", "すべて") },
    { value: "active", label: text("In progress", "进行中", "処理中") },
    { value: "succeeded", label: text(...STATUS_LABELS.succeeded) },
    { value: "failed", label: text(...STATUS_LABELS.failed) },
    { value: "cancelled", label: text(...STATUS_LABELS.cancelled) },
  ]

  const pollTasks = useCallback(async ({ signal, isCurrent }: SerialPollingContext) => {
    try {
      const result = await listTasks({ limit: PAGE_SIZE, offset, ...filterParams(filter) }, signal)
      if (!isCurrent()) return
      setListError("")
      // 当前页已被删空（例如在别处删除）时回到上一页。
      if (result.items.length === 0 && offset > 0) {
        setOffset(Math.max(0, offset - PAGE_SIZE))
        return
      }
      setTasks(result.items)
      setHasMore(result.has_more)
    } catch (err) {
      if (isCurrent() && !isAbortError(err)) {
        setListError(err instanceof Error ? err.message : String(err))
        setTasks((current) => current ?? [])
      }
    }
  }, [filter, offset])

  const invalidatePolling = useSerialPolling(pollTasks)

  function clearSelection() {
    setSelectedIds(new Set())
    setAllMatching(null)
  }

  function changeFilter(next: Filter) {
    if (next === filter) return
    setFilter(next)
    setOffset(0)
    setTasks(null)
    clearSelection()
    filterVersionRef.current += 1
  }

  function changePage(nextOffset: number) {
    setOffset(nextOffset)
    setTasks(null)
  }

  const pageDeletable = tasks?.filter(canDelete) ?? []
  const pageSelectedCount = pageDeletable.filter((task) => selectedIds.has(task.id)).length
  const allSelected = pageDeletable.length > 0 && pageSelectedCount === pageDeletable.length
  const someSelected = pageSelectedCount > 0 && !allSelected
  const selectedList = [...selectedIds]
  const multiplePages = hasMore || offset > 0
  const canSelectAllMatching = !allMatching && allSelected && multiplePages

  function toggleTask(id: string, checked: boolean) {
    setAllMatching(null)
    setSelectedIds((current) => {
      const next = new Set(current)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  function toggleAll(checked: boolean) {
    setAllMatching(null)
    setSelectedIds((current) => {
      const next = new Set(current)
      for (const task of pageDeletable) {
        if (checked) next.add(task.id)
        else next.delete(task.id)
      }
      return next
    })
  }

  async function selectAllMatching() {
    const version = filterVersionRef.current
    setSelectingAll(true)
    try {
      const ids = new Set<string>()
      let skipped = 0
      for (let pageOffset = 0; ; pageOffset += SELECT_ALL_PAGE_SIZE) {
        const result = await listTasks({ limit: SELECT_ALL_PAGE_SIZE, offset: pageOffset, ...filterParams(filter) })
        for (const task of result.items) {
          if (canDelete(task)) ids.add(task.id)
          else skipped += 1
        }
        if (!result.has_more || result.items.length === 0) break
      }
      if (version !== filterVersionRef.current) return
      setSelectedIds(ids)
      setAllMatching({ skipped })
    } catch (err) {
      if (version === filterVersionRef.current) setListError(err instanceof Error ? err.message : String(err))
    } finally {
      setSelectingAll(false)
    }
  }

  async function confirmDelete() {
    if (!pendingDeleteIds?.length) return
    invalidatePolling()
    setDeleting(true)
    setDeleteError("")
    setDeleteProgress({ done: 0, total: pendingDeleteIds.length })
    const deleted: string[] = []
    const failures: string[] = []
    // 逐个删除：后端一次只处理一个任务目录，失败的任务保留在列表里。
    for (const id of pendingDeleteIds) {
      try {
        await deleteTask(id)
        deleted.push(id)
      } catch (err) {
        // 已经不存在的任务（例如在别处删掉了）视为删除成功。
        if (err instanceof ApiError && err.status === 404) deleted.push(id)
        else failures.push(err instanceof Error ? err.message : String(err))
      }
      setDeleteProgress({ done: deleted.length + failures.length, total: pendingDeleteIds.length })
    }
    invalidatePolling()
    const removed = new Set(deleted)
    setTasks((current) => current?.filter((task) => !removed.has(task.id)) ?? current)
    setSelectedIds((current) => new Set([...current].filter((id) => !removed.has(id))))
    setAllMatching(null)
    setDeleting(false)
    if (failures.length) {
      setDeleteError(text(
        `${deleted.length} deleted, ${failures.length} failed: ${failures[0]}`,
        `已删除 ${deleted.length} 个，${failures.length} 个删除失败：${failures[0]}`,
        `${deleted.length} 件を削除、${failures.length} 件は失敗しました：${failures[0]}`,
      ))
      return
    }
    setPendingDeleteIds(null)
  }

  const page = Math.floor(offset / PAGE_SIZE) + 1
  const bulk = pendingDeleteIds !== null && pendingDeleteIds.length > 1

  return (
    <div className="mx-auto max-w-6xl px-5 py-8 sm:px-8 lg:py-12">
      <PageHeader
        title={t.nav.library}
        description={text(
          "Every imported video and its results. Open a task to preview, download or create it again with new settings.",
          "所有导入的视频及其成品。打开任务可以预览、下载，或换一套设置重新生成。",
          "読み込んだ動画とその結果の一覧です。タスクを開くと、プレビュー・ダウンロード・設定を変えての再生成ができます。",
        )}
        actions={
          <Button nativeButton={false} render={<Link href="/" />}>
            <Plus />
            {t.nav.newTask}
          </Button>
        }
      />

      <div
        role="group"
        aria-label={text("Task status", "任务状态", "タスクの状態")}
        className="-mx-5 mt-8 flex gap-1.5 overflow-x-auto px-5 pb-1 sm:mx-0 sm:px-0 sm:pb-0"
      >
        {filterOptions.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={filter === option.value}
            onClick={() => changeFilter(option.value)}
            className="inline-flex h-8 shrink-0 items-center rounded-full border border-border px-3.5 text-[13px] font-medium text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40 aria-pressed:border-transparent aria-pressed:bg-foreground aria-pressed:text-background"
          >
            {option.label}
          </button>
        ))}
      </div>

      {listError ? <InlineAlert className="mt-4">{listError}</InlineAlert> : null}

      <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-card shadow-card">
        {tasks && tasks.length > 0 ? (
          <div className="flex items-center border-b border-border pr-2 text-xs font-medium text-subtle-foreground sm:pr-3">
            <div className="flex w-12 shrink-0 justify-center">
              <Checkbox
                checked={allSelected}
                indeterminate={someSelected}
                disabled={pageDeletable.length === 0}
                onCheckedChange={(checked) => toggleAll(checked)}
                aria-label={text("Select all tasks on this page", "选择本页全部任务", "このページのタスクをすべて選択")}
              />
            </div>
            <span className="py-2.5 md:hidden">{text("Task", "任务", "タスク")}</span>
            <div className={cn("hidden flex-1 items-center gap-x-4 py-2.5 md:grid", ROW_GRID)}>
              <span className="col-span-2">{text("Task", "任务", "タスク")}</span>
              <span>{text("Status", "状态", "状態")}</span>
              <span>{text("Created", "创建时间", "作成日時")}</span>
            </div>
            <span className="w-8 shrink-0" aria-hidden="true" />
          </div>
        ) : null}

        {tasks === null ? (
          <ul aria-busy="true" aria-label={t.common.loading} className="divide-y divide-border">
            {[0, 1, 2, 3, 4].map((row) => (
              <li key={row} className="flex items-center gap-4 px-5 py-3.5">
                <Skeleton className="aspect-video w-20 rounded-md" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-2/3 max-w-md" />
                  <Skeleton className="h-3 w-1/3 max-w-52" />
                </div>
              </li>
            ))}
          </ul>
        ) : tasks.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-6 py-20 text-center">
            <span className="flex size-12 items-center justify-center rounded-2xl bg-accent">
              {filter === "all" ? <Inbox className="size-6 text-subtle-foreground" /> : <SearchX className="size-6 text-subtle-foreground" />}
            </span>
            <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
              {filter === "all"
                ? text("No tasks yet. Import a local video in the Studio to get started.", "还没有任务。在工作台导入一个本地视频即可开始。", "タスクはまだありません。スタジオでローカル動画を読み込んで始めましょう。")
                : text("No tasks in this view.", "暂无符合条件的任务。", "該当するタスクはありません。")}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {tasks.map((item) => {
              const deletable = canDelete(item)
              const active = isActiveStatus(item.status)
              const progress = item.stage_progress !== null && item.current_stage !== "done" ? Math.round(item.stage_progress * 100) : null
              const duration = formatMediaDuration(item.source_duration_ms)
              return (
                <li
                  key={item.id}
                  className={cn(
                    "group flex items-center pr-2 transition-colors hover:bg-accent/50 sm:pr-3",
                    selectedIds.has(item.id) && "bg-secondary/60 hover:bg-secondary/70",
                  )}
                >
                  <div className="flex w-12 shrink-0 justify-center">
                    <Checkbox
                      checked={selectedIds.has(item.id)}
                      disabled={!deletable}
                      onCheckedChange={(checked) => toggleTask(item.id, checked)}
                      aria-label={text(`Select ${item.source_name}`, `选择 ${item.source_name}`, `${item.source_name} を選択`)}
                      title={deletable ? undefined : text("Tasks in progress can't be deleted", "进行中的任务不能删除", "処理中のタスクは削除できません")}
                    />
                  </div>
                  <Link
                    href={`/tasks/${item.id}`}
                    className={cn(
                      "grid min-w-0 flex-1 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-2 rounded-lg py-3.5 outline-none focus-visible:ring-3 focus-visible:ring-ring/40",
                      ROW_GRID,
                    )}
                  >
                    <TaskCover id={item.id} size="sm" className="row-span-2 w-20 md:row-span-1" />
                    <div className="min-w-0">
                      <p className="line-clamp-2 text-sm font-medium break-words text-foreground md:line-clamp-1">{item.source_name}</p>
                      <p className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                        <span className="shrink-0 tabular-nums">
                          {duration ? `${duration} · ` : ""}
                          {formatBytes(item.source_size_bytes)}
                        </span>
                        {active ? (
                          <span className="hidden min-w-0 items-center gap-1 truncate font-medium text-status-running-fg sm:inline-flex">
                            <span aria-hidden="true">·</span>
                            {item.status === "queued"
                              ? item.wait_reason ? text(...WAIT_LABELS[item.wait_reason]) : t.nav.queuedOnly
                              : text(...STAGE_LABELS[item.current_stage])}
                            {item.status !== "queued" && progress !== null ? <span className="tabular-nums">{progress}%</span> : null}
                          </span>
                        ) : null}
                      </p>
                      {item.error ? (
                        <p className="mt-1 truncate text-xs text-status-danger-fg">{item.error.message}</p>
                      ) : null}
                    </div>
                    <div className="col-start-2 flex flex-wrap items-center gap-x-3 gap-y-1 md:contents">
                      <span>
                        <StatusBadge status={item.status}>{text(...STATUS_LABELS[item.status])}</StatusBadge>
                      </span>
                      <time
                        dateTime={item.created_at}
                        title={formatDateTime(item.created_at)}
                        className="text-xs tabular-nums text-muted-foreground md:text-[13px]"
                      >
                        {formatRelativeTime(item.created_at, language)}
                      </time>
                    </div>
                  </Link>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={text("More actions", "更多操作", "その他の操作")}
                          className="shrink-0 text-subtle-foreground opacity-100 group-hover:text-foreground md:opacity-60 md:group-hover:opacity-100 aria-expanded:opacity-100"
                        />
                      }
                    >
                      <Ellipsis />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuLinkItem render={<Link href={`/tasks/${item.id}`} />}>
                        <ChevronRight />
                        {text("Open task", "打开任务", "タスクを開く")}
                      </DropdownMenuLinkItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        disabled={!deletable}
                        onClick={() => {
                          setDeleteError("")
                          setPendingDeleteIds([item.id])
                        }}
                      >
                        <Trash2 />
                        {text("Delete task", "删除任务", "タスクを削除")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </li>
              )
            })}
          </ul>
        )}

        {tasks && (tasks.length > 0 || offset > 0) ? (
          <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3 text-[13px] text-muted-foreground sm:px-5">
            <span className="tabular-nums">{text(`Page ${page}`, `第 ${page} 页`, `${page} ページ`)}</span>
            <div className="flex items-center gap-1.5">
              <Button type="button" variant="outline" size="sm" onClick={() => changePage(Math.max(0, offset - PAGE_SIZE))} disabled={offset === 0}>
                <ChevronLeft />
                {text("Previous", "上一页", "前へ")}
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => changePage(offset + PAGE_SIZE)} disabled={!hasMore}>
                {text("Next", "下一页", "次へ")}
                <ChevronRight />
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      {selectedList.length > 0 ? (
        <div className="sticky bottom-24 z-30 mt-4 flex justify-center lg:bottom-6">
          <div className="glass flex animate-rise items-center gap-2 rounded-2xl border border-border py-2 pr-2 pl-4 shadow-float">
            <div className="flex min-w-0 flex-col sm:flex-row sm:items-center sm:gap-2.5">
              <span className="text-sm font-medium tabular-nums">
                {text(`${selectedList.length} selected`, `已选择 ${selectedList.length} 个任务`, `${selectedList.length} 件を選択中`)}
              </span>
              {allMatching && allMatching.skipped > 0 ? (
                <span className="text-xs text-muted-foreground">
                  {text(
                    `${allMatching.skipped} in-progress task${allMatching.skipped === 1 ? "" : "s"} can't be deleted`,
                    `另有 ${allMatching.skipped} 个进行中的任务不能删除`,
                    `処理中の ${allMatching.skipped} 件は削除できません`,
                  )}
                </span>
              ) : canSelectAllMatching ? (
                <button
                  type="button"
                  onClick={selectAllMatching}
                  disabled={selectingAll}
                  className="inline-flex w-fit items-center gap-1 rounded text-xs font-medium text-link outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/40 disabled:opacity-60 sm:text-[13px]"
                >
                  {selectingAll ? <Loader2 className="size-3.5 animate-spin" /> : null}
                  {text("Select tasks on all pages", "选择所有页的任务", "すべてのページのタスクを選択")}
                </button>
              ) : null}
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={clearSelection}>
              {text("Clear", "取消选择", "選択を解除")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={() => {
                setDeleteError("")
                setPendingDeleteIds(selectedList)
              }}
            >
              <Trash2 />
              {text("Delete selected", "删除所选", "選択したタスクを削除")}
            </Button>
          </div>
        </div>
      ) : null}

      <Dialog
        open={pendingDeleteIds !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setPendingDeleteIds(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {bulk
                ? text(`Delete ${pendingDeleteIds.length} tasks?`, `确认删除 ${pendingDeleteIds.length} 个任务？`, `${pendingDeleteIds.length} 件のタスクを削除しますか？`)
                : text("Delete this task?", "删除这个任务？", "このタスクを削除しますか？")}
            </DialogTitle>
            <DialogDescription>
              {bulk
                ? text("This removes the task records, source videos and generated local files.", "将删除这些任务的记录、导入的原视频和本机生成文件。", "タスクの記録、読み込んだ動画、この端末の生成ファイルを削除します。")
                : text("This removes the task record, source video and generated local files.", "将删除任务记录、导入的原视频和本机生成文件。", "タスクの記録、読み込んだ動画、この端末の生成ファイルを削除します。")}
            </DialogDescription>
          </DialogHeader>
          {deleteError ? <InlineAlert>{deleteError}</InlineAlert> : null}
          <DialogFooter>
            <DialogClose render={<Button variant="outline" disabled={deleting} />}>
              {t.common.cancel}
            </DialogClose>
            <Button variant="destructive" onClick={confirmDelete} disabled={deleting}>
              {deleting ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
              {deleting
                ? deleteProgress.total > 1
                  ? text(`Deleting ${deleteProgress.done}/${deleteProgress.total}`, `正在删除 ${deleteProgress.done}/${deleteProgress.total}`, `削除中 ${deleteProgress.done}/${deleteProgress.total}`)
                  : text("Deleting…", "正在删除…", "削除中…")
                : text("Delete task and files", "删除任务和文件", "タスクとファイルを削除")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
