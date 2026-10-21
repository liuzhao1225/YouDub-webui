import { useEffect, useState, type ReactNode } from 'react'
import { TranslationSetupController } from '@/runtime/onboarding'
import { useObservableSource } from '@/plugin/view-hooks'
import { LanguageProvider } from '@/lib/i18n'
import { ModelsSettings } from './models-settings'
import { TranslationSetupView } from './translation-setup-view'

export function TranslationSetup({ children }: { children: ReactNode }) {
  const [controller] = useState(() => new TranslationSetupController())
  const { ready } = useObservableSource(controller)
  useEffect(() => { controller.start(); return controller.stop }, [controller])
  if (ready) return children
  return <LanguageProvider><TranslationSetupView controller={controller} renderModels={props => <ModelsSettings {...props} />} /></LanguageProvider>
}
