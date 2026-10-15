import { PluginBootstrap } from '@/plugin/bootstrap'
import { SetupGate } from '@/components/setup-gate'
import { TranslationSetup } from '@/components/translation-setup'
export default function Page() { return <SetupGate><TranslationSetup><PluginBootstrap /></TranslationSetup></SetupGate> }
