import type { Request } from '@/plugin/runtime/types'
import { type ReactNode, useEffect, useState } from 'react'
import { useText } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { SetupScreen, type SetupScreenOptions } from './setup-screen'
import { SetupDiagnostics } from './setup-diagnostics'
import { SetupController } from '@/runtime/onboarding'
import { useObservableSource } from '@/plugin/view-hooks'
import { PageContainer } from './page-layout'

export function SetupGate({ children, request, screenProps, onReady }: { children: ReactNode; request?: Request; screenProps?: SetupScreenOptions; onReady?: () => void }) {
  const text = useText()
  const [controller] = useState(() => new SetupController(request))
  const { state, error, busy } = useObservableSource(controller)
  useEffect(() => { controller.start(); return controller.stop }, [controller])
  useEffect(() => { if (state?.phase === 'ready') onReady?.() }, [state?.phase, onReady])
  if (error) return <PageContainer as="main" className="max-w-3xl space-y-4 py-8 sm:py-12"><SetupDiagnostics state={state} requestError={error} /><Button onClick={controller.start}>{text('setup.reconnect')}</Button></PageContainer>
  if (state?.phase === 'ready') return children
  return state ? <SetupScreen {...screenProps} state={state} busy={busy} onAction={controller.action} onPrepare={controller.prepare} /> : <PageContainer as="main" className="max-w-3xl py-8 sm:py-12"><p role="status" className="text-sm text-muted-foreground">{text('setup.detecting')}</p></PageContainer>
}
