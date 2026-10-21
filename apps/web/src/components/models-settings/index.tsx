import { useCallback, useEffect, useMemo } from 'react'
import { useText } from '@/lib/i18n'
import { useObservableSource } from '@/plugin/web-react'
import type { Request } from '@/plugin/runtime/types'
import { modelsApi } from './api'
import { ModelsSection } from './ModelsSection'
import { ModelsSettingsStore, providerUsable, type ModelsSettingsState } from './store'
import { type ModelsKey } from './locales'

export interface ModelsSettingsProps {
  request: Request
  onDirtyChange?: (dirty: boolean) => void
  onBusyChange?: (busy: boolean) => void
  onReadyChange?: (ready: boolean) => void
}

export function ModelsSettings({ request, onDirtyChange, onBusyChange, onReadyChange }: ModelsSettingsProps) {
  const text = useText()
  const api = useMemo(() => modelsApi(request), [request])
  const controller = useMemo(() => new ModelsSettingsStore(api), [api])
  const state = useObservableSource(controller.store)
  const t = useCallback((key: ModelsKey) => text(`legacyModels.${key}`), [text])
  const useSnapshot = useMemo(() => function useSnapshot<V>(selector: (value: ModelsSettingsState) => V) {
    return selector(useObservableSource(controller.store))
  }, [controller])
  useEffect(() => { void controller.load() }, [controller])
  useEffect(() => { onReadyChange?.(state.status === 'ready' && state.credentialError === null && state.rows.some(providerUsable)) }, [onReadyChange, state])
  return <ModelsSection controller={controller} useSnapshot={useSnapshot} api={api} t={t} onDirtyChange={onDirtyChange} onBusyChange={onBusyChange} />
}
