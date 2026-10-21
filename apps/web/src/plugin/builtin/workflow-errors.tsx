import { Button } from '@/components/ui/button'
import { Link, type Diagnostic, type NodeTypeDefinition, type WorkflowDocument, text } from '../sdk'
import { useI18n, useText } from '@/lib/i18n'
import { InlineAlert } from '@/components/inline-alert'
import { nodeDefinition } from './workflow-utils'

export function workflowDiagnostics(error: unknown): Diagnostic[] {
  const details = (error as { details?: unknown } | null)?.details
  return Array.isArray(details) ? details.filter((item): item is Diagnostic => !!item && typeof item === 'object' && typeof item.message === 'string') : []
}

export function WorkflowDiagnostics({ diagnostics, document, types, onSelect, disabled = false }: { diagnostics: Diagnostic[]; document: WorkflowDocument; types: NodeTypeDefinition[]; onSelect?(diagnostic: Diagnostic): void; disabled?: boolean }) {
  const { language } = useI18n(), tx = useText()
  return diagnostics.map((item, index) => {
    const node = document.nodes.find((node) => node.id === item.nodeId)
    const label = node && (node.label || text(nodeDefinition(node, types)?.label, language) || tx("workflow.errors.node"))
    const connectionMissing = item.message === 'Provider connection is not configured.'
    const message = connectionMissing ? tx("workflow.errors.configure.the.service.address.and.api.key.in.settings")
      : item.message === 'Select a model and device.' ? tx("workflow.errors.select.a.model.and.device.for.this.node")
      : item.message === 'Selected model or device is unavailable.' ? tx("workflow.errors.the.selected.model.or.device.is.unavailable.choose.another.option") : item.message
    return <InlineAlert key={index}><div className="space-y-1.5"><p>{label ? `${label}: ` : ''}{message}</p>
      {connectionMissing && !disabled ? <Link href="/settings/models" className="inline-block text-xs underline underline-offset-4">{tx("workflow.errors.configure.connection")}</Link> : node && onSelect ? <Button variant="ghost" type="button" disabled={disabled} className="block h-auto p-0 text-xs underline underline-offset-4 disabled:opacity-50" onClick={() => onSelect(item)}>{tx("workflow.errors.open.node.settings")}</Button> : null}
      {message !== item.message && <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">{tx("workflow.errors.diagnostics")}</summary><p className="mt-1 break-words">{item.message}</p></details>}
    </div></InlineAlert>
  })
}
