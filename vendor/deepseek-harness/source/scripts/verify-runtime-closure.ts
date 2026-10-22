/** Verify required workspace peers in an explicitly selected runtime manifest. */
import { globSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'

interface PackageManifest {
  name?: string
  dependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  peerDependenciesMeta?: Record<string, { optional?: boolean }>
}

interface WorkspacePackage {
  path: string
  manifest: PackageManifest
}

export interface RuntimeClosureResult {
  failures: string[]
  workspacePackageCount: number
}

/**
 * Check the selected runtime manifest against all reachable required workspace peers.
 * @param root repository root.
 * @param manifestPath runtime manifest path relative to root.
 * @returns reachable workspace package count and dependency violations.
 */
export async function verifyRuntimeClosure(
  root: string,
  manifestPath: string,
): Promise<RuntimeClosureResult> {
  const runtimeManifest = await loadManifest(resolve(root, manifestPath))
  const runtimeName = runtimeManifest.name ?? manifestPath
  const workspace = await loadWorkspacePackages(root)
  const runtimeDependencies = runtimeManifest.dependencies ?? {}
  const parents = new Map<string, string | undefined>()
  const queue: string[] = []

  for (const dependency of Object.keys(runtimeDependencies).sort()) {
    if (!workspace.has(dependency)) continue
    parents.set(dependency, undefined)
    queue.push(dependency)
  }

  const failures: string[] = []
  for (let index = 0; index < queue.length; index += 1) {
    const packageName = queue[index]
    if (packageName === undefined) continue
    const current = workspace.get(packageName)
    if (current === undefined) continue
    const peers = current.manifest.peerDependencies ?? {}
    const peerMeta = current.manifest.peerDependenciesMeta ?? {}
    for (const peer of Object.keys(peers).sort()) {
      if (!workspace.has(peer) || peerMeta[peer]?.optional === true) continue
      if (Object.hasOwn(runtimeDependencies, peer)) continue
      failures.push(`${formatChain(runtimeName, packageName, parents)} -> ${peer}`)
    }
    const dependencies = {
      ...current.manifest.dependencies,
      ...current.manifest.optionalDependencies,
    }
    for (const dependency of Object.keys(dependencies).sort()) {
      if (!workspace.has(dependency) || parents.has(dependency)) continue
      parents.set(dependency, packageName)
      queue.push(dependency)
    }
  }

  return {
    failures,
    workspacePackageCount: queue.length,
  }
}

if (import.meta.main) {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: { manifest: { type: 'string' }, root: { type: 'string' } },
  })
  const root = values.root === undefined ? resolve(import.meta.dirname, '..') : resolve(values.root)
  if (values.manifest === undefined) throw new Error('verify-runtime-closure: --manifest is required')
  const result = await verifyRuntimeClosure(root, resolve(values.manifest))
  if (result.failures.length > 0) {
    console.error('verify-runtime-closure: required workspace peers are missing from the runtime manifest:')
    for (const failure of result.failures) console.error(`  ${failure}`)
    process.exitCode = 1
  } else {
    console.log(
      `verify-runtime-closure: ${result.workspacePackageCount} workspace packages form a closed runtime dependency graph.`,
    )
  }
}

async function loadWorkspacePackages(root: string): Promise<Map<string, WorkspacePackage>> {
  const paths = globSync(['packages/*/*/package.json', 'vendor/*/package.json'], { cwd: root })
    .sort()
    .map(relative => resolve(root, relative))
  const result = new Map<string, WorkspacePackage>()
  for (const path of paths) {
    const manifest = await loadManifest(path)
    if (manifest.name !== undefined) result.set(manifest.name, { path, manifest })
  }
  return result
}

async function loadManifest(path: string): Promise<PackageManifest> {
  return loadJson<PackageManifest>(path)
}

async function loadJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T
}

function formatChain(
  runtimeName: string,
  packageName: string,
  parents: ReadonlyMap<string, string | undefined>,
): string {
  const chain = [packageName]
  let parent = parents.get(packageName)
  while (parent !== undefined) {
    chain.unshift(parent)
    parent = parents.get(parent)
  }
  return [runtimeName, ...chain].join(' -> ')
}
