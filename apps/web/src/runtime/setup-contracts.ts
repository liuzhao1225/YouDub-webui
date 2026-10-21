import type { LocalizedText } from '@/plugin/contracts'

export interface EnvironmentStep {
  id: string; name: string; status: 'pending' | 'running' | 'ready' | 'failed'; detail?: string; source?: string
}
export interface SetupModel {
  id: string; name: string; variant: string; purpose: string
  status: 'pending' | 'downloading' | 'paused' | 'ready' | 'failed'
  received: number; total: number; speed: number; source?: string; error?: string
}
export type SetupAction = 'pause' | 'resume' | 'retry'
export interface ResourceSelection { providerId: string; model?: string }
export interface ResourceRequirement extends ResourceSelection {
  ready: boolean; automatic: boolean; missingPackages: string[]; reason?: string; configurationRequired?: boolean
}
export interface ResourcePreparation {
  status: 'missing' | 'preparing' | 'ready' | 'failed'
  selections: ResourceSelection[]; requirements: ResourceRequirement[]
  environment: EnvironmentStep[]; models: SetupModel[]; error?: string
  activePreparation?: { selections: ResourceSelection[]; status: ResourcePreparation['status']; error?: string }
}
export interface SetupState {
  phase: 'environment' | 'models' | 'starting' | 'ready' | 'failed'
  platform: string; arch: string; version?: string; osVersion?: string; homeDir?: string
  environment: EnvironmentStep[]; models: SetupModel[]; error?: string; canRetry: boolean; token: string
  resources?: ResourcePreparation
  resourceSelection?: { required: boolean; selections: ResourceSelection[]; items: ResourceItem[]; prepared: boolean }
}
export interface ResourceItem extends ResourceSelection {
  label: LocalizedText; automatic: boolean; downloadId?: string
}
export interface ResourceInventory {
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
    environment, models: inventory.models, error: resource?.error, resources: undefined, canRetry: true, token: '' }
}
