import { PageHeader } from '@/components/page-layout'
import { useMemo } from 'react'
import { Loader2, RefreshCw } from '@/lib/icons'
import { Button } from '@/components/ui/button'
import { InlineAlert } from '@/components/inline-alert'
import { SectionCard } from '@/components/section-card'
import { SetupDiagnostics } from '@/components/setup-diagnostics'
import { ResourceRow } from '@/components/resource-row'
import { useText } from '@/lib/i18n'
import { useObservableSource } from '@/plugin/view-hooks'
import { ResourcesController } from '@/plugin/runtime/workflow-resources'
import type { Request } from '@/plugin/runtime/types'
import { mergeResourceEntries, resourceSetupState, type ResourceAction, type ResourceEntry } from '@/runtime/setup-contracts'

export function SettingsResources({ request, title }: { request: Request; title?: string }) {
  const tx = useText()
  const controller = useMemo(() => new ResourcesController(request), [request])
  const { inventory, inspection, checking, error } = useObservableSource(controller)
  const state = inventory && resourceSetupState(inventory, inspection)
  const entries = mergeResourceEntries(inspection?.entries ?? [], inventory?.resources?.entries)
  const preparing = inventory?.resources?.status === 'preparing'
  const act = (action: ResourceAction, entry: ResourceEntry) => action === 'prepare' ? controller.prepareResource(entry.id) : controller.action(action, entry.id)
  const refresh = <Button variant="ghost" size="sm" disabled={checking} onClick={controller.check}><RefreshCw className={checking ? 'animate-spin' : undefined} />{tx('settings.resources.check.again')}</Button>
  return <div className="space-y-8">
    {title ? <PageHeader title={title} actions={refresh} /> : <div className="flex justify-end">{refresh}</div>}
    {error && <InlineAlert>{error}</InlineAlert>}
    {!inspection && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">{checking && <Loader2 className="size-4 animate-spin" />}{tx(checking ? 'settings.resources.checking.resources' : 'settings.resources.environment.not.checked')}</p>}
    {(['environment', 'model'] as const).map(group => entries.some(entry => entry.group === group) && <SectionCard key={group} title={tx(group === 'environment' ? 'settings.resources.runtime.environment' : 'settings.resources.local.models')}><div className="divide-y divide-border px-4">
      {entries.filter(entry => entry.group === group).map(entry => <ResourceRow key={entry.id} entry={entry} busy={checking || preparing && !['pause', 'resume'].some(action => entry.actions.includes(action as ResourceAction))} onAction={act} />)}
    </div></SectionCard>)}
    <SetupDiagnostics state={state} requestError={error} />
  </div>
}
