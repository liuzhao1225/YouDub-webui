import { Service, type Context } from 'cordis'
import { AppError, type CatalogService, type OperationProvider, type WorkflowDefinition } from '@youdub/sdk'

export default class Catalog extends Service implements CatalogService {
  private providers = new Map<string, OperationProvider>()
  private workflows = new Map<string, WorkflowDefinition>()
  constructor(ctx: Context) { super(ctx, 'catalog') }
  private register<T extends { id: string }>(map: Map<string, T>, contribution: T) {
    if (!contribution.id || map.has(contribution.id)) throw new AppError('DUPLICATE_CONTRIBUTION', `Duplicate or empty ID: ${contribution.id}`, 500)
    map.set(contribution.id, contribution)
    return () => { map.delete(contribution.id) }
  }
  registerProvider(provider: OperationProvider) { return this.register(this.providers, provider) }
  registerWorkflow(workflow: WorkflowDefinition) { return this.register(this.workflows, workflow) }
  provider(id: string) { const value = this.providers.get(id); if (!value) throw new AppError('PROVIDER_UNAVAILABLE', `Provider ${id} is not registered.`, 422); return value }
  workflow(id: string) { const value = this.workflows.get(id); if (!value) throw new AppError('WORKFLOW_UNAVAILABLE', `Workflow ${id} is not registered.`, 422); return value }
  describe() { return { providers: [...this.providers.values()].map(item => item.describe()), workflows: [...this.workflows.values()].map(item => item.describe()) } }
  async refresh() { await Promise.all([...this.providers.values()].map(provider => provider.probe())) }
}
