import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const RUNTIME_SECTIONS = ['dependencies', 'optionalDependencies', 'peerDependencies'] as const

interface WorkspaceListEntry {
  name: string
  path: string
}

/** One workspace manifest available to the packed-install rehearsal. */
export interface WorkspacePackage {
  name: string
  directory: string
  manifest: Record<string, unknown>
}

function dependencyEntries(
  manifest: Record<string, unknown>,
  section: (typeof RUNTIME_SECTIONS)[number],
): [string, string][] {
  const value = manifest[section]
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return []
  return Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
}

function optionalPeer(manifest: Record<string, unknown>, name: string): boolean {
  const metadata = manifest.peerDependenciesMeta
  if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)) return false
  const entry = (metadata as Record<string, unknown>)[name]
  return entry !== null && typeof entry === 'object' && !Array.isArray(entry)
    && (entry as Record<string, unknown>).optional === true
}

/**
 * Read the root pnpm workspace inventory and its package manifests.
 * @param repoRoot - repository root containing the pnpm workspace.
 * @returns Workspace packages indexed by package name.
 */
export function readWorkspacePackages(repoRoot: string): Map<string, WorkspacePackage> {
  const listed = spawnSync('pnpm', ['list', '--recursive', '--depth', '-1', '--json'], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 30_000,
  })
  if (listed.status !== 0) {
    throw new Error(`pnpm workspace inventory failed:\n${listed.stdout}\n${listed.stderr}`)
  }
  const parsed: unknown = JSON.parse(listed.stdout)
  if (!Array.isArray(parsed)) throw new Error('pnpm workspace inventory is not an array')
  const packages = new Map<string, WorkspacePackage>()
  for (const value of parsed) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('pnpm workspace inventory contains a non-object entry')
    }
    const { name, path } = value as Partial<WorkspaceListEntry>
    if (typeof name !== 'string' || typeof path !== 'string') {
      throw new Error('pnpm workspace inventory entry lacks name/path')
    }
    const parsedManifest: unknown = JSON.parse(readFileSync(join(path, 'package.json'), 'utf8'))
    if (parsedManifest === null || typeof parsedManifest !== 'object' || Array.isArray(parsedManifest)) {
      throw new Error(`${path}/package.json is not an object`)
    }
    const manifest = parsedManifest as Record<string, unknown>
    if (manifest.name !== name) throw new Error(`${path}/package.json does not declare ${name}`)
    if (packages.has(name)) throw new Error(`pnpm workspace inventory repeats ${name}`)
    packages.set(name, { name, directory: path, manifest })
  }
  return packages
}

/**
 * Follow install dependencies and required peers inside one workspace.
 * @param rootName - package whose consumer closure is required.
 * @param packages - workspace packages indexed by package name.
 * @returns Transitive runtime closure sorted by package directory.
 */
export function packedWorkspaceClosure(
  rootName: string,
  packages: ReadonlyMap<string, WorkspacePackage>,
): WorkspacePackage[] {
  const closure: WorkspacePackage[] = []
  const visited = new Set<string>()
  const visit = (name: string): void => {
    if (visited.has(name)) return
    visited.add(name)
    const current = packages.get(name)
    if (current === undefined) throw new Error(`packed workspace closure cannot resolve ${name}`)
    closure.push(current)
    for (const section of RUNTIME_SECTIONS) {
      for (const [dependency, range] of dependencyEntries(current.manifest, section)) {
        if (!range.startsWith('workspace:')) continue
        if (section === 'peerDependencies' && optionalPeer(current.manifest, dependency)) continue
        visit(dependency)
      }
    }
  }
  visit(rootName)
  return closure.sort((left, right) => left.directory.localeCompare(right.directory))
}
