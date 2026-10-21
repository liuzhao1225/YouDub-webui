import { type ReactNode, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { SetupScreen } from './setup-screen'
import { SetupDiagnostics } from './setup-diagnostics'
import { SetupController } from '@/runtime/onboarding'
import { useObservableSource } from '@/plugin/web-react'

export function SetupGate({ children }: { children: ReactNode }) {
  const [controller] = useState(() => new SetupController())
  const { state, error, busy } = useObservableSource(controller)
  useEffect(() => { controller.start(); return controller.stop }, [controller])
  if (error) return <main className="mx-auto max-w-3xl space-y-4 p-8"><SetupDiagnostics state={state} requestError={error} /><Button onClick={controller.start}>重新连接</Button></main>
  if (state?.phase === 'ready') return children
  return state ? <SetupScreen state={state} busy={busy} onAction={controller.action} /> : <div role="status" className="p-8 text-sm text-muted-foreground">检测运行环境…</div>
}
