'use client'
import { type ReactNode, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { SetupScreen, type SetupState, type SetupAction } from './setup-screen'

async function request(init?: RequestInit): Promise<SetupState> {
  const response = await fetch('/api/setup', { ...init, cache: 'no-store', credentials: 'same-origin' })
  const body = await response.text()
  if (!response.ok) throw new Error(`环境准备请求失败 (${response.status})：${body.slice(0, 1000)}`)
  return JSON.parse(body)
}
export function SetupGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SetupState | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    const controller = new AbortController()
    async function poll() {
      try {
        const next = await request({ signal: controller.signal })
        if (stopped) return
        setState(next)
        if (next.phase !== 'ready') timer = setTimeout(poll, 800)
      } catch (failure) { if (!stopped) setError(failure instanceof Error ? failure.message : String(failure)) }
    }
    void poll()
    return () => { stopped = true; controller.abort(); clearTimeout(timer) }
  }, [attempt])
  async function action(action: SetupAction, id?: string) {
    if (!state || busy) return
    setBusy(true)
    try {
      const next = await request({ method: 'POST', headers: { 'Content-Type': 'application/json', 'X-YouDub-Setup': state.token }, body: JSON.stringify({ action, id }) })
      setState(next)
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { setBusy(false) }
  }
  if (error) return <main className="mx-auto max-w-3xl space-y-4 p-8"><p role="alert" className="whitespace-pre-wrap break-words text-sm text-status-danger-fg">{error}</p><Button onClick={() => { setError(''); setAttempt(value => value + 1) }}>重新连接</Button></main>
  if (state?.phase === 'ready') return children
  return state ? <SetupScreen state={state} busy={busy} onAction={action} /> : <div role="status" className="p-8 text-sm text-muted-foreground">检测运行环境…</div>
}
