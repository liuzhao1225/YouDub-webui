import { AppError, type ProviderDescription } from '@youdub/sdk'
import manifest from '../../../backend/requirements/resources.json' with { type: 'json' }
import models from './setup-models.json' with { type: 'json' }

export type DependencyGroup = keyof typeof manifest.groups
export const dependencyGroups = Object.keys(manifest.groups) as DependencyGroup[]
export const acceleratedGroups = dependencyGroups.filter(group => 'accelerated' in manifest.groups[group])
export function builtinResources(id: string): ProviderDescription['resources'] {
  const definition = manifest.providers[id as keyof typeof manifest.providers]
  return definition ? structuredClone(definition) : undefined
}

export function providerResources(provider: ProviderDescription) {
  const resources = provider.resources
  if (!resources) return undefined
  if (!Array.isArray(resources.dependencyGroups) || resources.dependencyGroups.some(group => !dependencyGroups.includes(group as DependencyGroup)) ||
      (resources.model && (!resources.model.id || !models.some(model => model.id === resources.model!.downloadId)))) {
    throw new AppError('INVALID_RESOURCE_DESCRIPTOR', `Invalid resource requirements for ${provider.id}.`, 422)
  }
  return { ...resources, dependencyGroups: resources.dependencyGroups as DependencyGroup[] }
}
