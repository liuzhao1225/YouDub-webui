/** Prepare the disposable npm-project view used by an unpackaged Electron shell. */

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { createDevelopmentProjectMetadata } from '../src/project-manager.ts'
import type { DesktopRelease } from '../src/release.ts'
import { DESKTOP_RUNTIME_FILE, type DesktopRuntimeDescriptor } from '../src/runtime-tree.ts'
import type { DesktopAutoUpdateTarget } from './desktop-auto-update-environment.mjs'
import { desktopTargetPlatform } from './desktop-build-paths.mjs'

interface PackageManifest {
  readonly name?: string
  readonly version?: string
  readonly dependencies?: Readonly<Record<string, string>>
  readonly peerDependencies?: Readonly<Record<string, string>>
  readonly peerDependenciesMeta?: Readonly<Record<string, { optional?: boolean }>>
}

/** Inputs whose locations differ between the launcher and isolated tests. */
export interface DevelopmentProjectOptions {
  /** Directory replaced with the generated development project. */
  readonly projectDir: string
  /** Current workspace's `apps/cli` package directory. */
  readonly cliDir: string
  /** Current workspace's private Desktop Host application directory. */
  readonly hostDir: string
  /** pnpm's workspace-wide virtual-hoist directory. */
  readonly dependencyDir: string
  /** Product-selected packages resolved from dependencyDir; unrelated hoisted packages are excluded. */
  readonly packages?: readonly string[]
  /** Release identity written into the disposable project metadata. */
  readonly release: DesktopRelease
  /** Build target whose prepared payload the disposable project runs against. */
  readonly target: DesktopAutoUpdateTarget
}

function readManifest(path: string): PackageManifest {
  return JSON.parse(readFileSync(path, 'utf8')) as PackageManifest
}

function removeOwnedPath(path: string): void {
  let stat: ReturnType<typeof lstatSync>
  try {
    stat = lstatSync(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  if (stat.isSymbolicLink()) {
    unlinkSync(path)
    return
  }
  if (stat.isDirectory()) {
    rmSync(path, { recursive: true })
    return
  }
  unlinkSync(path)
}

function linkDirectory(source: string, destination: string): void {
  mkdirSync(dirname(destination), { recursive: true })
  symlinkSync(realpathSync(source), destination, process.platform === 'win32' ? 'junction' : 'dir')
}

/** Link selected packages and their declared workspace dependencies, including required peers. */
function mirrorRuntimePackages(roots: readonly string[], destinationRoot: string): string[] {
  const selected = new Map<string, string>()
  const visit = (directory: string): void => {
    const source = realpathSync(directory)
    const manifest = readManifest(join(source, 'package.json'))
    if (typeof manifest.name !== 'string' || manifest.name === '') {
      throw new Error(`desktop development: missing package name in ${source}`)
    }
    const existing = selected.get(manifest.name)
    if (existing !== undefined) {
      if (existing !== source) throw new Error(`desktop development: conflicting sources for ${manifest.name}`)
      return
    }
    selected.set(manifest.name, source)
    linkDirectory(source, join(destinationRoot, manifest.name))
    for (const [name, specifier] of Object.entries({ ...manifest.peerDependencies, ...manifest.dependencies })) {
      if (!specifier.startsWith('workspace:')) continue
      const dependency = join(source, 'node_modules', name)
      if (!existsSync(dependency)) {
        if (manifest.dependencies?.[name] === undefined && manifest.peerDependenciesMeta?.[name]?.optional === true) continue
        throw new Error(`desktop development: ${name} is missing from ${source}; run pnpm install`)
      }
      visit(dependency)
    }
  }
  for (const directory of roots) visit(directory)
  return [...selected.keys()].sort()
}

/**
 * Replace one disposable project with links to the current built workspace.
 * @param options - Project destination, CLI package, release identity, and build target.
 * @returns the absolute project directory supplied by the caller.
 */
export function prepareDevelopmentProject(options: DevelopmentProjectOptions): string {
  const cliManifest = readManifest(join(options.cliDir, 'package.json'))
  if (cliManifest.name !== '@deepseek-ai/dsh' || cliManifest.version !== options.release.version) {
    throw new Error(
      `desktop development: apps/cli must be @deepseek-ai/dsh@${options.release.version}, found `
      + `${String(cliManifest.name)}@${String(cliManifest.version)}`,
    )
  }
  if (!existsSync(options.dependencyDir)) {
    throw new Error('desktop development: workspace dependency links are missing; run pnpm install')
  }
  const hostManifest = readManifest(join(options.hostDir, 'package.json'))
  if (hostManifest.name !== '@deepseek-ai/dsh-desktop-host' || hostManifest.version !== options.release.version) {
    throw new Error(
      `desktop development: apps/desktop-host must be @deepseek-ai/dsh-desktop-host@${options.release.version}, found `
      + `${String(hostManifest.name)}@${String(hostManifest.version)}`,
    )
  }
  if (!existsSync(join(options.hostDir, 'lib', 'index.js'))) {
    throw new Error('desktop development: apps/desktop-host/lib/index.js is missing; run pnpm run build')
  }

  removeOwnedPath(options.projectDir)
  createDevelopmentProjectMetadata(options.projectDir, options.release)
  const destinationModules = join(options.projectDir, 'node_modules')
  mkdirSync(destinationModules, { recursive: true })
  const names = mirrorRuntimePackages([
    options.cliDir, options.hostDir,
    ...(options.packages ?? []).map(name => join(options.dependencyDir, name)),
  ], destinationModules)
  const sharedPackages = names.map((name) => {
    const manifest = readManifest(join(destinationModules, name, 'package.json'))
    if (typeof manifest.version !== 'string') throw new Error(`desktop development: missing version for ${name}`)
    return { name, version: manifest.version, path: `node_modules/${name}` }
  })
  // Profile resolution reads this application's declarations, rather than the
  // CLI package's old all-product dependency list.
  const projectManifest = readManifest(join(options.projectDir, 'package.json'))
  writeFileSync(join(options.projectDir, 'package.json'), `${JSON.stringify({
    ...projectManifest,
    dependencies: Object.fromEntries(sharedPackages.map(pkg => [pkg.name, pkg.version])),
  }, undefined, 2)}\n`)
  const runtime: DesktopRuntimeDescriptor = { schemaVersion: 1, release: options.release,
    ...desktopTargetPlatform(options.target), sharedPackages, files: [] }
  writeFileSync(join(options.projectDir, DESKTOP_RUNTIME_FILE), `${JSON.stringify(runtime, undefined, 2)}\n`)
  return options.projectDir
}
