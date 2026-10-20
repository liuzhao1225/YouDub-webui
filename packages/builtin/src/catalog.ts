import { Service, type Context } from 'cordis'
import { AppError, type CatalogService, type OperationProvider, type RegisteredWorkflow, type WorkflowDefinition } from '@youdub/sdk'

export default class Catalog extends Service implements CatalogService {
  private providers = new Map<string, OperationProvider>()
  private workflows = new Map<string, RegisteredWorkflow>()
  constructor(ctx: Context) { super(ctx, 'catalog') }
  private register<T extends { id: string }>(map: Map<string, T>, contribution: T) {
    if (!contribution.id || map.has(contribution.id)) throw new AppError('DUPLICATE_CONTRIBUTION', `Duplicate or empty ID: ${contribution.id}`, 500)
    map.set(contribution.id, contribution)
    return () => { map.delete(contribution.id) }
  }
  registerProvider(provider: OperationProvider) {
    for (const operation of provider.describe().operations) {
      const node = operation.node
      if (!node) continue
      const keys = [...node.inputs.map(port => port.id), ...Object.keys(node.runtimeInputSchema?.properties ?? {})]
      const fields = Object.keys(operation.inputSchema.properties ?? {})
      if (new Set(keys).size !== keys.length || keys.some(key => !fields.includes(key)) || fields.some(key => !keys.includes(key))) throw new AppError('INVALID_NODE_CONTRACT', `Node ${node.type} input ports and runtime fields must match ${operation.id}.`, 422)
      if (node.inputs.some(port => !port.acceptedSchemaIds.length || Boolean(operation.inputSchema.required?.includes(port.id)) !== port.required)) throw new AppError('INVALID_NODE_CONTRACT', `Node ${node.type} has inconsistent required inputs.`, 422)
      if ((node.ui?.quickFields?.length ?? 0) > 3 || node.ui?.quickFields?.some(key => !(key in (node.configSchema.properties ?? {})))) throw new AppError('INVALID_NODE_CONTRACT', `Node ${node.type} quick fields are invalid.`, 422)
      if (node.corrections && (!provider.validateCorrection || node.corrections.outputPorts.some(name => !operation.outputs.some(port => port.name === name && node.corrections!.schemaIds.includes(port.schemaId))))) throw new AppError('INVALID_NODE_CONTRACT', `Node ${node.type} correction contract is incomplete.`, 422)
    }
    return this.register(this.providers, provider)
  }
  registerWorkflow(workflow: RegisteredWorkflow) { return this.register(this.workflows, workflow) }
  provider(id: string) { const value = this.providers.get(id); if (!value) throw new AppError('PROVIDER_UNAVAILABLE', `Provider ${id} is not registered.`, 422); return value }
  workflow(id: 'youdub.localize'): WorkflowDefinition
  workflow(id: string): RegisteredWorkflow
  workflow(id: string) { const value = this.workflows.get(id); if (!value) throw new AppError('WORKFLOW_UNAVAILABLE', `Workflow ${id} is not registered.`, 422); return value }
  listProviders() { return [...this.providers.values()].map(item => item.describe()) }
  describe() { return { providers: this.listProviders(), workflows: [...this.workflows.values()].map(item => item.describe()) } }
  async refresh() { await Promise.all([...this.providers.values()].map(provider => provider.probe())) }
}
