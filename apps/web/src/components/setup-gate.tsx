import type { Request } from '@/plugin/runtime/types'
import { type ReactNode, useEffect, useState } from 'react'
import { useText } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { SetupScreen, type SetupScreenOptions } from './setup-screen'
import { SetupDiagnostics } from './setup-diagnostics'
import { SetupController } from '@/runtime/onboarding'
import { useObservableSource } from '@/plugin/view-hooks'
import { SetupPage } from './setup-page'

export function SetupGate({ children, request, screenProps }: { children: ReactNode; request: Request; screenProps: SetupScreenOptions }) {
  const text = useText()
  const [controller] = useState(() => new SetupController(request))
  const { state, error, busy } = useObservableSource(controller)
  useEffect(() => { controller.start(); return controller.stop }, [controller])
  if (error) return <SetupPage wordmarkSrc={screenProps.wordmarkSrc} actions={screenProps.themeControl}><SetupDiagnostics state={state} requestError={error} /><div><Button onClick={controller.start}>{text('setup.reconnect')}</Button></div></SetupPage>
  if (state?.phase === 'ready') return children
  return state ? <SetupScreen {...screenProps} state={state} busy={busy} onAction={controller.action} onPrepare={controller.prepare} onConfigure={controller.configure} /> : <SetupPage wordmarkSrc={screenProps.wordmarkSrc} actions={screenProps.themeControl}><p role="status" className="text-sm text-muted-foreground">{text('setup.detecting')}</p></SetupPage>
}
