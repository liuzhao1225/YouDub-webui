import { Disclosure } from '@/components/ui/disclosure'
import { Check, Download, Loader2, RotateCcw } from '@/lib/icons'
import { Link, text, type NodeTypeDefinition } from '../sdk'
import { useI18n, useText } from '@/lib/i18n'
import { ResourceRow } from '@/components/resource-row'
import { Button } from '@/components/ui/button'
import { InlineAlert } from '@/components/inline-alert'

import type { WorkflowResourcesResult } from '../runtime/workflow-resources'
export type { ResourceState } from '../runtime/workflow-resources'

export function WorkflowResources({ resources, types, disabled = false, hideReady = false }: { resources: WorkflowResourcesResult; types: NodeTypeDefinition[]; disabled?: boolean; hideReady?: boolean }) {
  const tx = useText(), { language } = useI18n()
  const state = resources.result
  const preparing = state?.status === 'preparing'
  const paused = state?.entries?.some(entry => entry.status === 'paused')
  const otherPreparing = state?.activePreparation?.status === 'preparing'
  const missing = state?.requirements?.filter((item) => !item.ready) ?? []
  const manual = missing.some((item) => !item.automatic)
  const configurationMissing = missing.some((item) => item.configurationRequired)
  const unconfigured = missing.filter(item => item.configurationRequired)
  const unconfiguredProvider = unconfigured.length === 1 ? types.find(type => type.providerId === unconfigured[0].providerId)?.provider : undefined
  const configurationName = unconfigured.length === 1 ? unconfiguredProvider?.capability === 'translation' ? tx("workflow.resources.translation.service") : text(unconfiguredProvider?.label, language) || unconfigured[0].providerId : undefined
  if (hideReady && resources.ready && state?.status === 'ready' && !resources.checking && !resources.error && !state.error && !state.activePreparation) return null
  const failure = state?.error && (typeof state.error === 'string' ? state.error : state.error.message)
  const status = <p className="flex items-center gap-2" role="status">
      {resources.ready ? <Check className="size-4 text-status-success-fg" /> : resources.checking || preparing ? <Loader2 className="size-4 animate-spin" /> : null}
      {resources.error ? tx("workflow.resources.could.not.check.resource.status") : preparing ? tx("workflow.resources.preparing.required.resources") : resources.checking ? tx("workflow.resources.checking.required.resources") : state?.status === 'ready' ? tx("workflow.resources.resources.ready") : state?.status === 'failed' ? tx("workflow.resources.resource.preparation.failed") : configurationName ? tx("workflow.resources.value.not.configured", { value1: configurationName }) : configurationMissing ? tx("workflow.resources.configure.the.required.service") : tx("workflow.resources.required.resources.are.missing")}
    </p>
  const details = state?.status !== 'ready' && <>
      {missing.filter(item => item.configurationRequired || !state?.entries?.some(entry => entry.id === item.resourceId)).map((item) => {
        const provider = types.find((type) => type.providerId === item.providerId)?.provider
        const label = text(provider?.label, language) || item.providerId
        const reason = item.reason === 'Provider connection is not configured.' ? tx("workflow.resources.configure.the.service.url.api.key.and.model") : item.reason
        return <div key={`${item.providerId}:${item.model}`}><p className="font-medium">{label}{item.model ? ` · ${item.model}` : ''}</p>{reason && (!item.automatic || state?.status === 'failed' ? <p className="break-words text-xs text-muted-foreground">{reason}</p> : <Disclosure  contained={false} title={<>{tx("workflow.resources.diagnostics")}</>}><p className="mt-1 break-words">{reason}</p></Disclosure>)}</div>
      })}
      {state?.entries?.map(entry => <ResourceRow key={entry.id} entry={entry} busy={disabled || resources.checking || Boolean(otherPreparing) && !entry.actions.some(action => action === 'pause' || action === 'resume')} onAction={resources.action ? (action, entry) => action === 'prepare' ? resources.prepare() : resources.action!(action, entry.downloadId) : undefined} />)}

    </>
  const actions = resources.error ? <Button variant="outline" size={hideReady ? "sm" : "default"} disabled={disabled || resources.checking} onClick={resources.check}><RotateCcw />{tx("workflow.resources.check.again")}</Button> : state && state.status !== 'ready' && !preparing && !otherPreparing && (manual ? <>
      {configurationMissing ? <Link href="/settings/models" className="inline-flex text-sm text-link hover:underline">{tx("workflow.resources.configure.service.connection")}</Link> : hideReady ? <Link href="/settings/resources" className="inline-flex text-sm text-link hover:underline">{tx("workflow.resources.environment.models")}</Link> : <p className="text-xs text-muted-foreground">{tx("workflow.resources.complete.the.plugin.setup.above.then.check.again")}</p>}
      <Button variant="outline" size={hideReady ? "sm" : "default"} disabled={disabled || resources.checking} onClick={resources.check}><RotateCcw />{tx("workflow.resources.check.again")}</Button>
    </> : <Button variant="outline" size={hideReady ? "sm" : "default"} disabled={disabled || resources.checking} onClick={() => paused && resources.action ? resources.action('resume') : resources.prepare()}><Download />{paused ? tx('resource.action.resume') : state.status === 'failed' ? tx('resource.action.retry') : tx('resource.prepareRequired')}</Button>)
  return <section aria-label={tx("workflow.resources.workflow.resources")} className="space-y-3 text-sm">
    <div className={hideReady ? 'flex flex-wrap items-center gap-3' : 'space-y-3'}>{status}<div className={hideReady ? 'ml-auto flex flex-wrap items-center gap-3' : 'flex flex-wrap items-center gap-3'}>{actions}</div>
      {hideReady && details && <Disclosure inline contained={false} title={<>{tx("workflow.resources.resource.details")}</>}><div className="basis-full space-y-3">{details}</div></Disclosure>}
    </div>
    {failure && <InlineAlert>{failure}</InlineAlert>}
    {otherPreparing && <InlineAlert tone="warning">{tx("workflow.resources.another.workflow.is.preparing.resources.its.progress.is.checked.a")}</InlineAlert>}
    {state?.activePreparation?.status === 'failed' && state.activePreparation.error && <InlineAlert>{state.activePreparation.error}</InlineAlert>}
    {resources.error && <InlineAlert>{resources.error}</InlineAlert>}

    {!hideReady && details}
  </section>
}
