import { useMemo } from 'react'
import { Check, Download, Loader2, Pause, Play, RefreshCw, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { InlineAlert } from '@/components/inline-alert'
import { SectionCard } from '@/components/section-card'
import { SetupDiagnostics } from '@/components/setup-diagnostics'
import { EnvironmentSteps, ModelDownloadRow } from '@/components/setup-resources'
import { useI18n, useText } from '@/lib/i18n'
import { text } from '@/plugin/sdk'
import { useObservableSource } from '@/plugin/view-hooks'
import { ResourcesController } from '@/plugin/runtime/workflow-resources'
import type { Request } from '@/plugin/runtime/types'
import { resourceSetupState, type ResourceItem } from '@/runtime/setup-contracts'

export function SettingsResources({ request }: { request: Request }) {
  const tx = useText(), { language } = useI18n()
  const controller = useMemo(() => new ResourcesController(request), [request])
  const { inventory, inspection, checking, error } = useObservableSource(controller)
  const preparing = inventory?.resources?.status === 'preparing'
  const state = inventory && resourceSetupState(inventory, inspection)
  const media = inventory?.items.find(item => item.providerId === 'youdub.media' && !item.model)
  const mediaInEnvironment = Boolean(media && state?.environment.some(step => step.id === 'ffmpeg'))
  const requirement = (item: ResourceItem) => inspection?.requirements.find(selected => selected.providerId === item.providerId && selected.model === item.model)
  const label = (item: ResourceItem) => text(item.label, language) || item.providerId
  function control(item: ResourceItem) {
    const model = inventory?.models.find(model => model.id === item.downloadId)
    const current = item.downloadId && inventory?.resources?.models.some(model => model.id === item.downloadId)
    if (!inspection && !current) return <span className="text-xs text-muted-foreground">{checking ? tx("settings.resources.checking") : tx("settings.resources.not.checked")}</span>
    if (model && current && ['downloading', 'paused', 'failed'].includes(model.status)) {
      const action = model.status === 'downloading' ? 'pause' : model.status === 'failed' ? 'retry' : 'resume'
      const title = action === 'pause' ? tx("settings.resources.pause") : action === 'retry' ? tx("settings.resources.retry") : tx("settings.resources.resume")
      return <Button variant="ghost" size="sm" disabled={checking} aria-label={`${title} ${model.name}`} onClick={() => controller.action(action, model.id)}>{action === 'pause' ? <Pause /> : action === 'retry' ? <RotateCcw /> : <Play />}{title}</Button>
    }
    if (requirement(item)?.ready) return <span className="inline-flex items-center gap-1 text-xs text-status-success-fg"><Check className="size-4" />{tx("settings.resources.ready")}</span>
    if (!item.automatic) return <span className="text-xs text-muted-foreground">{tx("settings.resources.manual.setup.required")}</span>
    const waiting = preparing && inventory?.resources?.selections.some(selected => selected.providerId === item.providerId && selected.model === item.model)
    return <Button variant="outline" size="sm" disabled={checking || preparing} onClick={() => controller.prepare([{ providerId: item.providerId, ...(item.model ? { model: item.model } : {}) }])}>
      {waiting ? <Loader2 className="animate-spin" /> : <Download />}
      {waiting ? tx("settings.resources.preparing") : model?.status === 'ready' || !model ? tx("settings.resources.prepare.dependencies") : tx("settings.resources.download")}
    </Button>
  }
  return <div className="space-y-5">
    <div className="flex justify-end"><Button variant="ghost" size="sm" disabled={checking} onClick={controller.check}><RefreshCw className={checking ? 'animate-spin' : undefined} />{tx("settings.resources.check.again")}</Button></div>
    {error && <InlineAlert>{error}</InlineAlert>}
    {!inventory && !error && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />{tx("settings.resources.checking.resources")}</p>}
    {inventory && state && <>
      <SectionCard title={tx("settings.resources.runtime.environment")}>
        <div className="divide-y divide-border px-5">{inspection || inventory.resources ? <EnvironmentSteps steps={state.environment} actions={mediaInEnvironment && media ? { ffmpeg: control(media) } : undefined} /> : <p role="status" className="py-4 text-sm text-muted-foreground">{checking ? tx("settings.resources.checking.environment") : tx("settings.resources.environment.not.checked")}</p>}</div>
        {inventory.items.filter(item => !item.model && !(item.providerId === 'youdub.media' && mediaInEnvironment)).map(item => <div key={item.providerId} className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-4">
          <div className="min-w-0"><p className="text-sm font-medium">{label(item)}</p>{requirement(item)?.reason && <p className="mt-1 break-words text-xs text-muted-foreground">{requirement(item)?.reason}</p>}</div>{control(item)}
        </div>)}
        {inventory.resources?.status === 'failed' && inventory.resources.environment.some(step => step.status === 'failed') && <div className="border-t border-border p-4"><Button variant="outline" size="sm" disabled={checking} onClick={() => controller.action('retry')}><RotateCcw />{tx("settings.resources.retry.preparation")}</Button></div>}
      </SectionCard>
      {inventory.items.some(item => item.model) && <SectionCard title={tx("settings.resources.local.models")}><div className="divide-y divide-border px-5">
        {inventory.items.filter(item => item.model).map(item => {
          const model = inventory.models.find(model => model.id === item.downloadId)
          return <div key={`${item.providerId}:${item.model}`}>
            {model ? <ModelDownloadRow model={model} action={control(item)} /> : <div className="flex flex-wrap items-center justify-between gap-3 py-4"><p className="text-sm font-medium">{label(item)} · {item.model}</p>{control(item)}</div>}
            {requirement(item)?.reason && !preparing && <details className="mb-4 text-xs text-muted-foreground"><summary className="cursor-pointer">{tx("settings.resources.diagnostics")}</summary><p className="mt-2 break-words">{requirement(item)?.reason}</p></details>}
          </div>
        })}
      </div></SectionCard>}
    </>}
    <SetupDiagnostics state={state} requestError={error} />
  </div>
}
