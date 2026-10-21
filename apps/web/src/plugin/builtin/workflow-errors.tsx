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
    const label = node && (node.label || text(nodeDefinition(node, types)?.label, language) || tx('Node', '节点', 'ノード'))
    const connectionMissing = item.message === 'Provider connection is not configured.'
    const message = connectionMissing ? tx('Configure the service address and API key in Settings.', '请在设置中填写服务地址和 API Key。', '設定でサービスのアドレスと API キーを入力してください。')
      : item.message === 'Select a model and device.' ? tx('Select a model and device for this node.', '请为此节点选择模型和运行设备。', 'このノードのモデルと実行デバイスを選択してください。')
      : item.message === 'Selected model or device is unavailable.' ? tx('The selected model or device is unavailable. Choose another option.', '所选模型或运行设备不可用，请重新选择。', '選択したモデルまたはデバイスは利用できません。選択し直してください。') : item.message
    return <InlineAlert key={index}><div className="space-y-1.5"><p>{label ? `${label}: ` : ''}{message}</p>
      {connectionMissing && !disabled ? <Link href="/settings/connections" className="inline-block text-xs underline underline-offset-4">{tx('Configure connection', '配置服务连接', 'サービス接続を設定')}</Link> : node && onSelect ? <button type="button" disabled={disabled} className="block text-xs underline underline-offset-4 disabled:opacity-50" onClick={() => onSelect(item)}>{tx('Open node settings', '打开节点设置', 'ノード設定を開く')}</button> : null}
      {message !== item.message && <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">{tx('Diagnostics', '诊断详情', '診断の詳細')}</summary><p className="mt-1 break-words">{item.message}</p></details>}
    </div></InlineAlert>
  })
}
