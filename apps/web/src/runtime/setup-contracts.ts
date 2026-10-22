import type { LocalizedText } from '@/plugin/contracts'
import { resourceEntries, type ResourceEntry } from '../../../../packages/sdk/src/resource-state'
export { resourceEntries, mergeResourceEntries } from '../../../../packages/sdk/src/resource-state'
export type { ResourceEntry, ResourceAction, ResourceStatus, ResourcePhase } from '../../../../packages/sdk/src/resource-state'

export interface EnvironmentStep {
  id: string; name: string; status: 'pending' | 'running' | 'ready' | 'failed'; detail?: string; source?: string
  phase?: 'downloading' | 'installing' | 'verifying'; progress?: { received: number; total: number; speed?: number }
  activity?: string; log?: string; startedAt?: number; updatedAt?: number
}
export interface SetupModel {
  id: string; name: string; variant: string; purpose: string
  status: 'pending' | 'downloading' | 'paused' | 'ready' | 'failed'
  received: number; total: number; speed: number; source?: string; error?: string; log?: string
}
export type SetupAction = 'pause' | 'resume' | 'retry'
export interface ResourceSelection { providerId: string; model?: string }
export interface ResourceRequirement extends ResourceSelection {
  ready: boolean; automatic: boolean; missingPackages: string[]; reason?: string; configurationRequired?: boolean
}
export interface ResourcePreparation {
  entries?: ResourceEntry[]
  status: 'missing' | 'preparing' | 'ready' | 'failed'
  selections: ResourceSelection[]; requirements: ResourceRequirement[]
  environment: EnvironmentStep[]; models: SetupModel[]; error?: string
  activePreparation?: { selections: ResourceSelection[]; status: ResourcePreparation['status']; error?: string }
}
export interface SetupState {
  entries?: ResourceEntry[]
  phase: 'installation' | 'environment' | 'models' | 'starting' | 'ready' | 'failed'
  platform: string; arch: string; version?: string; osVersion?: string; homeDir?: string
  environment: EnvironmentStep[]; models: SetupModel[]; error?: string; canRetry: boolean; token: string
  installation?: { required: boolean; path: string }
  resources?: ResourcePreparation
  resourceSelection?: { required: boolean; selections: ResourceSelection[]; items: ResourceItem[]; prepared: boolean }
}
export interface ResourceItem extends ResourceSelection {
  label: LocalizedText; automatic: boolean; downloadId?: string
}
export interface ResourceInventory {
  entries?: ResourceEntry[]
  version: string; platform: string; arch: string; osVersion: string; homeDir: string
  environment: EnvironmentStep[]; items: ResourceItem[]; models: SetupModel[]; resources?: ResourcePreparation
}

/** The setup screen and authenticated resource page share the same diagnostic projection. */
export function resourceSetupState(inventory: ResourceInventory, checked?: ResourcePreparation): SetupState {
  const resource = inventory.resources
  const environment = resource?.status === 'preparing' || resource?.status === 'failed'
    ? resource.environment : checked?.environment || resource?.environment || inventory.environment
  const failed = resource?.status === 'failed' || environment.some(step => step.status === 'failed') || inventory.models.some(model => model.status === 'failed')
  return { ...inventory, phase: failed ? 'failed' : resource?.status === 'preparing' || checked?.status !== 'ready' ? 'models' : 'ready',
    entries: checked?.entries, environment, models: inventory.models, error: resource?.error, resources: undefined, canRetry: true, token: '' }
}

export function setupResourceEntries(state: SetupState): ResourceEntry[] {
  if (state.resources?.entries) return state.resources.entries
  if (state.entries?.length) return state.entries
  return resourceEntries({ status: state.phase === 'environment' || state.phase === 'models' && !state.resourceSelection?.required ? 'preparing' : state.phase,
    environment: state.environment, models: state.models,
    requirements: state.models.map(model => ({ providerId: model.id, resourceId: model.id, name: model.name, downloadId: model.id, automatic: true, ready: state.phase === 'ready', dependencies: state.environment.filter(step => step.id !== 'dependencies').map(step => step.id) })) })
}
