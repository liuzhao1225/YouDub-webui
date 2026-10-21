/** YouDub first-run layout with the unchanged Harness provider editor and services. */
import React, { useEffect, useState, useSyncExternalStore } from 'react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { TranslationSetupController } from '../../../web/src/runtime/onboarding'
import { TranslationSetupView } from '../../../web/src/components/translation-setup-view'
import { ModelsSection } from '../../../../vendor/deepseek-harness/source/packages/client/ui-settings-models/src/client/ModelsSection'
import { ModelsSettingsStore } from '../../../../vendor/deepseek-harness/source/packages/client/ui-settings-models/src/client/store'
import { createModelsOperations } from '../../../../vendor/deepseek-harness/source/packages/client/ui-settings-models/src/client/operations'
import { createSettingsSchemaOperations } from '../../../../vendor/deepseek-harness/source/packages/client/ui-settings-models/src/client/schema-operations'
import type { Request } from '../../../web/src/plugin/runtime/types'

export function applyTranslationSetup(ctx: any) {
  const schema = createSettingsSchemaOperations(ctx.settingsSchema)
  const models = new ModelsSettingsStore(ctx, schema, ctx.configForms.describe())
  const activity = createSnapshotStore({ pending: 0 })
  const operations = Object.fromEntries(Object.entries(createModelsOperations(ctx)).map(([name, operation]) => [name, async (...args: any[]) => {
    activity.update(state => { state.pending++ })
    try { return await (operation as (...values: any[]) => unknown)(...args) }
    finally { activity.update(state => { state.pending-- }) }
  }]))
  const refresh = () => {
    if (models.store.getSnapshot().status === 'idle') return
    void models.load().catch(error => models.store.update(state => { state.status = 'error'; state.error = error instanceof Error ? error.message : String(error) }))
  }
  ctx.effect(() => {
    const disposers = ['settings/document-updated', 'credentials/record-updated', 'credentials/reference-updated', 'llm/adapters-updated'].map(event => ctx.remote.$on(event, refresh))
    disposers.push(ctx.on('connection/reset', refresh))
    return () => disposers.forEach(dispose => dispose())
  })
  ctx.slots.inject('youdub.setup.models', () => ctx.slots.register({
    name: 'youdub.setup.models',
    inject: () => ({ controller: models, hooks: { snapshot: models.store }, operations, schema, t: ctx.locale.bind('settings.models') }),
    children: {
      'youdub.setup.models.provider-card': { kind: 'keyed', scope: 'root' },
      'youdub.setup.models.footer': { kind: 'list', scope: 'root' },
    },
  }, SetupModelsSection))
  return { models: models.store, activity }
}

function SetupModelsSection({ renderSlot, ...props }: any) {
  const slots: Record<string, string> = {
    'settings.models.provider-card': 'youdub.setup.models.provider-card',
    'settings.models.footer': 'youdub.setup.models.footer',
  }
  return <ModelsSection {...props} renderSlot={(name: string, ...args: any[]) => {
    if (!slots[name]) throw new Error(`Unknown model setup slot: ${name}`)
    return renderSlot(slots[name], ...args)
  }} />
}

export function TranslationSetup({ request, onReady, wordmarkSrc, renderSlot, translationModels }: {
  request: Request
  onReady(): void
  wordmarkSrc: string
  renderSlot: (name: string) => React.ReactNode
  translationModels: ReturnType<typeof applyTranslationSetup>
}) {
  const [controller] = useState(() => new TranslationSetupController(request))
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  const models = useSyncExternalStore(translationModels.models.subscribe, translationModels.models.getSnapshot)
  const activity = useSyncExternalStore(translationModels.activity.subscribe, translationModels.activity.getSnapshot)
  useEffect(() => { controller.start(); return controller.stop }, [controller])
  useEffect(() => { if (state.ready) onReady() }, [state.ready, onReady])
  useEffect(() => { if (models.status === 'ready') void controller.refreshConfigured() }, [controller, models])
  // onReady releases this root registration; stop rendering its outlets before that effect runs.
  if (state.ready) return null
  return <TranslationSetupView controller={controller} wordmarkSrc={wordmarkSrc} renderModels={props => <ModelsSurface busy={activity.pending > 0} onBusyChange={props.onBusyChange}>{renderSlot('youdub.setup.models')}</ModelsSurface>} />
}

function ModelsSurface({ busy, onBusyChange, children }: { busy: boolean; onBusyChange(busy: boolean): void; children: React.ReactNode }) {
  useEffect(() => onBusyChange(busy), [busy, onBusyChange])
  return children
}
