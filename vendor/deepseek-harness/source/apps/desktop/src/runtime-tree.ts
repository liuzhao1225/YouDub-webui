/** Metadata for the product-selected Desktop runtime and shared plugin packages. */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { valid } from 'semver'
import type { DesktopRelease } from './release.ts'

/** Private package that boots the Desktop Host process. */
export const DESKTOP_HOST_PACKAGE = '@deepseek-ai/dsh-desktop-host'

/** Descriptor at the root of the immutable Desktop resource tree. */
export const DESKTOP_RUNTIME_FILE = 'desktop-runtime.json'

/** Host-owned package available to external plugins through a directory link. */
export interface DesktopSharedPackage {
  readonly name: string
  readonly version: string
  readonly path: string
}

/** Final bytes and executable permissions of a runtime file. */
export interface DesktopRuntimeFile {
  readonly path: string
  readonly bytes: number
  readonly sha256: string
  readonly executable: boolean
}

/** One signed application's production dependency tree. */
export interface DesktopRuntimeDescriptor {
  readonly schemaVersion: 1
  readonly release: DesktopRelease
  readonly platform: NodeJS.Platform
  readonly arch: string
  readonly sharedPackages: readonly DesktopSharedPackage[]
  readonly files: readonly DesktopRuntimeFile[]
}

const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/[a-z0-9][a-z0-9._~-]*|[a-z0-9][a-z0-9._~-]*)$/u

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Read packaged metadata and check shared package records.
 * @param root - Current application's runtime resources.
 * @returns Runtime metadata with the shared package paths and core versions checked.
 */
export function readDesktopRuntime(root: string): DesktopRuntimeDescriptor {
  const value: unknown = JSON.parse(readFileSync(join(root, DESKTOP_RUNTIME_FILE), 'utf8'))
  if (!record(value) || typeof value.platform !== 'string' || typeof value.arch !== 'string'
    || !Array.isArray(value.sharedPackages) || !Array.isArray(value.files)) {
    throw new Error('desktop runtime: invalid descriptor')
  }
  if (!record(value.release) || typeof value.release.version !== 'string'
    || typeof value.release.nodeVersion !== 'string' || typeof value.release.pnpmVersion !== 'string') {
    throw new Error('desktop runtime: invalid release fields')
  }
  const release = value.release as unknown as DesktopRelease
  const sharedPackages = value.sharedPackages.map((entry: unknown): DesktopSharedPackage => {
    if (!record(entry) || typeof entry.name !== 'string' || !PACKAGE_NAME.test(entry.name)
      || typeof entry.version !== 'string' || valid(entry.version) === null || entry.path !== `node_modules/${entry.name}`) {
      throw new Error('desktop runtime: invalid shared package record')
    }
    return { name: entry.name, version: entry.version, path: entry.path }
  })
  if (new Set(sharedPackages.map(entry => entry.name)).size !== sharedPackages.length) {
    throw new Error('desktop runtime: duplicate shared package')
  }
  const files = value.files as DesktopRuntimeFile[]
  for (const name of ['@deepseek-ai/dsh', DESKTOP_HOST_PACKAGE]) {
    if (sharedPackages.find(entry => entry.name === name)?.version !== release.version) {
      throw new Error(`desktop runtime: missing or mismatched ${name}`)
    }
  }
  return { schemaVersion: value.schemaVersion as 1, release, platform: value.platform as NodeJS.Platform,
    arch: value.arch, sharedPackages, files }
}
