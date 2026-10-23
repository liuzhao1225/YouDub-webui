import { Disclosure } from '@/components/ui/disclosure'
import { Button } from '@/components/ui/button'
import { Link, type Diagnostic, type NodeTypeDefinition, type WorkflowDocument, text } from '../sdk'
import { useI18n, useText } from '@/lib/i18n'
import { InlineAlert } from '@/components/inline-alert'
import type { MessageKey } from '@/locales'
import { nodeDefinition } from './workflow-utils'

const graphMessages: Record<string, MessageKey> = {
  "Add at least one node.": "workflow.errors.add.node",
  "Select at least one output.": "workflow.errors.select.output",
  "Connect this node to a final output.": "workflow.errors.connect.output",
  "Connection references a missing port.": "workflow.errors.missing.port",
  "Incompatible port types.": "workflow.errors.incompatible.ports",
  "An input accepts one connection.": "workflow.errors.single.connection",
  "Final output must reference a matching artifact output.": "workflow.errors.matching.output",
  "Workflow contains a cycle.": "workflow.errors.cycle",
  "This node has no runtime inputs.": "workflow.errors.no.runtime.inputs",
}

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
      : item.message === 'Selected model or device is unavailable.' ? tx("workflow.errors.the.selected.model.or.device.is.unavailable.choose.another.option") : graphMessages[item.message] ? tx(graphMessages[item.message]) : item.message
    return <InlineAlert key={index}><div className="space-y-1.5"><p>{label ? `${label}: ` : ''}{message}</p>
      {connectionMissing && !disabled ? <Link href="/settings/models" className="inline-block text-xs underline underline-offset-4">{tx("workflow.errors.configure.connection")}</Link> : node && onSelect ? <Button variant="link" size="sm" type="button" disabled={disabled} onClick={() => onSelect(item)}>{tx("workflow.errors.open.node.settings")}</Button> : null}
      {message !== item.message && <Disclosure  contained={false} title={tx("workflow.errors.diagnostics")}><p className="mt-1 break-words">{item.message}</p></Disclosure>}
    </div></InlineAlert>
  })
}
