"use client"

import { useRouter } from "next/navigation"
import { FormEvent, useEffect, useState } from "react"
import { Copy, Loader2, RotateCw, Square, Trash2, TriangleAlert } from "lucide-react"
import { InlineAlert } from "@/components/inline-alert"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { TaskConfigForm, configProblem } from "@/components/v1-task-config"
import { ApiError, isAbortError } from "@/lib/api"
import { cancelTask, deleteTask, getRuntime, getSettings, getTask, rerunTask, retryTask, type RerunRequest, type Runtime, type Settings, type Task, type TaskConfig } from "@/lib/v1-api"
import { useV1Text } from "@/lib/v1-ui"

type Props = {
  task: Task
  onMutationStart: () => void
  onMutationEnd: () => void
  onTaskChange: (task: Task) => void
  onDeleted: () => void
  // 删除确认框开关时通知详情页，以便先释放正在读取产物的播放器。
  onDeleteDialogChange?: (open: boolean) => void
}

export function TaskActions({ task, onMutationStart, onMutationEnd, onTaskChange, onDeleted, onDeleteDialogChange }: Props) {
  const router = useRouter()
  const text = useV1Text()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [rerunOpen, setRerunOpen] = useState(false)
  const [context, setContext] = useState<{ runtime: Runtime; settings: Settings } | null>(null)
  const [contextError, setContextError] = useState("")
  const [contextRevision, setContextRevision] = useState(0)
  const [draft, setDraft] = useState<TaskConfig>(task.config)
  const [acknowledged, setAcknowledged] = useState(false)
  const [pending, setPending] = useState<RerunRequest | null>(null)
  const [rejected, setRejected] = useState(false)

  useEffect(() => {
    if (!rerunOpen) return
    const controller = new AbortController()
    Promise.all([getRuntime(controller.signal), getSettings(controller.signal)]).then(([runtime, settings]) => {
      if (!controller.signal.aborted) setContext({ runtime, settings })
    }).catch((err) => {
      if (!controller.signal.aborted && !isAbortError(err)) setContextError(err instanceof Error ? err.message : String(err))
    })
    return () => controller.abort()
  }, [rerunOpen, contextRevision])

  function changeDeleteOpen(open: boolean) {
    setDeleteOpen(open)
    onDeleteDialogChange?.(open)
  }

  async function mutate(operation: () => Promise<void>) {
    if (busy) return
    setBusy(true)
    setError("")
    onMutationStart()
    try { await operation() }
    catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { onMutationEnd(); setBusy(false) }
  }

  function openRerun() {
    if (!pending) {
      setDraft(task.config)
      setAcknowledged(false)
      setError("")
    }
    setContext(null)
    setContextError("")
    setRerunOpen(true)
  }

  function openCreated(id: string) {
    setPending(null)
    setRejected(false)
    setRerunOpen(false)
    router.push(`/tasks/${id}`)
  }

  async function sendRerun(request: RerunRequest) {
    await mutate(async () => {
      setPending(request)
      try {
        const created = await rerunTask(task.id, request)
        openCreated(created.id)
      } catch (err) {
        if (err instanceof ApiError && err.code === "TASK_EXISTS") {
          openCreated(request.id)
          return
        }
        setRejected(err instanceof ApiError && err.status >= 400 && err.status < 500 && err.code !== "IMPORT_IN_PROGRESS")
        throw err
      }
    })
  }

  function submitRerun(event: FormEvent) {
    event.preventDefault()
    if (busy || pending || !context || contextError || problem || !task.allowed_actions.includes("rerun") || (task.external_operation.may_still_run && !acknowledged)) return
    void sendRerun({ id: crypto.randomUUID(), config: draft, acknowledge_external_risk: acknowledged })
  }

  const problem = context ? configProblem(draft, context.runtime, context.settings, text) : null
  const canRerun = task.allowed_actions.includes("rerun")
  const pendingNotice = pending ? <div className="space-y-3 rounded-xl border border-status-warning/30 bg-status-warning/10 p-3.5 text-sm text-status-warning-fg">
    <p className="flex items-start gap-2 leading-relaxed"><TriangleAlert className="mt-0.5 size-4 shrink-0" />{rejected ? text("The new task was rejected. Clear its incomplete files before submitting corrected settings.", "新任务创建失败。可修改配置，清理本次复制残留后再提交。", "新規作成に失敗しました。設定を変更し、不完全なファイルを削除してから再送信してください。") : text("Keep this ID while checking the creation result.", "请保留此 ID 并查询新任务创建结果。", "この ID を保持して作成結果を確認してください。")}</p>
    <code className="block rounded-lg bg-card px-2.5 py-2 font-mono text-xs break-all text-foreground/85">{pending.id}</code>
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void mutate(async () => {
        const created = await getTask(pending.id)
        openCreated(created.id)
      })}>{text("Check new task", "查询新任务", "新しいタスクを確認")}</Button>
      {rejected ? <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void mutate(async () => {
        await deleteTask(pending.id)
        setPending(null); setRejected(false)
      })}>{text("Clear incomplete copy", "清理本次复制残留", "不完全なコピーを削除")}</Button> : <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void sendRerun(pending)}>{text("Resend with the same ID", "使用同一 ID 重新提交", "同じ ID で再送信")}</Button>}
    </div>
  </div> : null
  return <div className="space-y-2.5">
    {task.allowed_actions.includes("retry") && <Button size="lg" className="w-full" disabled={busy} onClick={() => {
      const expectedAttempt = task.attempt
      void mutate(async () => onTaskChange(await retryTask(task.id, expectedAttempt)))
    }}><RotateCw />{text("Retry from start", "从头重试", "最初から再試行")}</Button>}
    {task.allowed_actions.includes("cancel") && <Button size="lg" variant="outline" className="w-full" disabled={busy} onClick={() => void mutate(async () => onTaskChange(await cancelTask(task.id)))}><Square />{text("Cancel task", "取消任务", "タスクをキャンセル")}</Button>}
    {(canRerun || pending) && <Button size="lg" variant="outline" className="w-full" disabled={busy} onClick={openRerun}><Copy />{text("Create with new settings", "重新生成", "設定を変えて生成")}</Button>}
    {task.allowed_actions.includes("retry") && <p className="text-xs leading-relaxed text-muted-foreground">{text("Retry uses this task's saved configuration and starts from preparation. Model services may charge again.", "重试沿用本任务的固定配置，从准备阶段开始，可能产生新的模型费用。", "再試行は保存済みの設定で準備段階から開始します。モデルの利用料金が再度発生する場合があります。")}</p>}
    {busy && <p role="status" className="flex items-center gap-2 text-[13px] text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />{text("Applying the action…", "正在处理操作…", "操作を実行中…")}</p>}
    {error && !rerunOpen && !deleteOpen && <InlineAlert>{error}</InlineAlert>}
    {task.allowed_actions.includes("delete") && <Button variant="ghost" className="w-full text-status-danger-fg hover:bg-status-danger/10 hover:text-status-danger-fg" disabled={busy || !!pending} onClick={() => { changeDeleteOpen(true); setError("") }}><Trash2 />{text("Delete task", "删除任务", "タスクを削除")}</Button>}

    <Dialog open={deleteOpen} onOpenChange={(open) => { if (!busy) changeDeleteOpen(open) }}>
      <DialogContent>
        <DialogHeader><DialogTitle>{text("Delete this task?", "删除这个任务？", "このタスクを削除しますか？")}</DialogTitle>
          <DialogDescription>{text("This removes the task record, source video and generated local files.", "将删除任务记录、导入的原视频和本机生成文件。", "タスクの記録、読み込んだ動画、この端末の生成ファイルを削除します。")}</DialogDescription>
        </DialogHeader>
        {task.external_operation.may_still_run && <InlineAlert tone="warning">{text("The remote request may continue after local deletion.", "删除本机文件后，远端请求可能仍会继续。", "端末上で削除しても、外部サービスの処理は続く可能性があります。")}</InlineAlert>}
        {error && <InlineAlert>{error}</InlineAlert>}
        <DialogFooter><Button variant="outline" disabled={busy} onClick={() => changeDeleteOpen(false)}>{text("Keep task", "保留任务", "タスクを残す")}</Button>
          <Button variant="destructive" disabled={busy || !task.allowed_actions.includes("delete")} onClick={() => void mutate(async () => {
            await deleteTask(task.id)
            onDeleted()
          })}>{busy ? <Loader2 className="animate-spin" /> : <Trash2 />}{text("Delete task and files", "删除任务和文件", "タスクとファイルを削除")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog open={rerunOpen} onOpenChange={(open) => { if (!busy) setRerunOpen(open) }}>
      <DialogContent className="max-h-[calc(100dvh-4rem)] overflow-y-auto sm:max-w-2xl sm:max-h-[calc(100dvh-8rem)]">
        <DialogHeader><DialogTitle>{text("Create with new settings", "重新生成", "設定を変えて生成")}</DialogTitle>
          <DialogDescription>{text("Copy the source video into a new task. The original task and its results remain unchanged.", "复制原视频并创建新任务，原任务和成品保持不变。", "元の動画をコピーして新しいタスクを作成します。元のタスクと結果は保持されます。")}</DialogDescription>
        </DialogHeader>
        {error && <InlineAlert>{error}</InlineAlert>}
        {contextError && <div className="space-y-3"><InlineAlert>{contextError}</InlineAlert>
          <Button variant="outline" onClick={() => { setContextError(""); setContextRevision((value) => value + 1) }}><RotateCw />{text("Reload models", "重新读取模型", "モデルを再読み込み")}</Button>
        </div>}
        {!context && !contextError && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />{text("Loading available models…", "正在读取可用模型…", "利用可能なモデルを読み込み中…")}</p>}
        {context && <form onSubmit={submitRerun} className="space-y-5">
          <fieldset disabled={busy || (!!pending && !rejected)} className="space-y-5 disabled:opacity-70">
            <TaskConfigForm value={draft} runtime={context.runtime} onChange={setDraft} />
            {task.external_operation.may_still_run && <label className="flex items-start gap-2.5 rounded-xl border border-status-warning/30 bg-status-warning/10 p-3.5 text-sm leading-relaxed text-status-warning-fg">
              <input className="mt-1 accent-current" type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />
              {text("I understand the previous remote request may still run and this new task may incur an additional charge.", "我已知悉原远端请求可能仍在执行，新任务可能产生重复费用。", "元のリクエストが実行中の可能性があり、新しいタスクで追加料金が発生することを理解しました。")}
            </label>}
          </fieldset>
          {problem && <InlineAlert tone="warning">{problem}</InlineAlert>}
          {!canRerun && !pending && <InlineAlert tone="warning">{text("The task state changed. Reload it before creating another task.", "任务状态已变化，请先重新查看任务。", "タスクの状態が変わりました。作成前に状態を確認してください。")}</InlineAlert>}
          {pendingNotice}
          <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={() => setRerunOpen(false)}>{text("Close", "关闭", "閉じる")}</Button>
            <Button type="submit" disabled={busy || !!pending || !!problem || !!contextError || !canRerun || (task.external_operation.may_still_run && !acknowledged)}>{text("Create new task", "创建新任务", "新しいタスクを作成")}</Button>
          </DialogFooter>
        </form>}
        {!context && pendingNotice}
      </DialogContent>
    </Dialog>
  </div>
}
