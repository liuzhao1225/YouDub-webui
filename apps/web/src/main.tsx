import { lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { PluginBootstrap } from './plugin/bootstrap'
import { SetupGate } from './components/setup-gate'
import { TranslationSetup } from './components/translation-setup'
import './app/globals.css'

const ModelSetupPreview = import.meta.env.DEV ? lazy(() => import('./preview/model-setup')) : null
const container = document.getElementById('root')
if (!container) throw new Error('YouDub root element is missing')

createRoot(container).render(ModelSetupPreview && window.location.pathname === '/preview/model-setup'
  ? <Suspense><ModelSetupPreview /></Suspense>
  : <SetupGate><TranslationSetup><PluginBootstrap /></TranslationSetup></SetupGate>)
