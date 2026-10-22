/**
 * Generate `THIRD_PARTY_NOTICES.md` from the workspace manifests: every
 * external dependency named by a workspace `package.json`, the vendored-package
 * manifest in `vendor/README.md`, the shared
 * Python distribution lock, and the pnpm patch list. npm metadata comes from the installed
 * store, so the tree must be installed. `--check` verifies the committed
 * artifact. Tier policy and ownership live in
 * `.agents/notes/implemented/process/2026-07-30-generated-third-party-notices.md`.
 */

import { existsSync, globSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import * as yaml from 'js-yaml'
import parseSpdx from 'spdx-expression-parse'
import primaryRuntimeLock from './primary-runtime/lock.json' with { type: 'json' }
import { browserBundledExternals } from './browser-bundled-externals.ts'

const root = resolve(import.meta.dirname, '..')
const OUT = 'THIRD_PARTY_NOTICES.md'

/** Dependency-declaration kinds a consumer resolves at runtime. */
const RUNTIME_KINDS = ['dependencies', 'optionalDependencies'] as const
/** All manifest sections that name an external package this file must disclose. */
const ALL_KINDS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'] as const

/**
 * Workspace areas that never reach a user: repository tooling and gates (the
 * root manifest), test infrastructure, the documentation site, and the native
 * launcher's build workspace. A runtime
 * declaration by anything outside these areas is a disclosure-relevant
 * runtime dependency because any plugin package can be mounted from a user's
 * `cordis.yml`.
 */
const DEV_ONLY_AREAS = [
  'package.json',
  'packages/test-support/',
  'packages/test-support/client-runtime/',
  'website/',
  'native/',
] as const

/** First-party public native packages: reachable at runtime but not third-party. */
const FIRST_PARTY = new Set([
  '@deepseek-ai/node-addon-system',
  '@deepseek-ai/node-addon-system-darwin-arm64',
  '@deepseek-ai/node-addon-system-darwin-x64',
  '@deepseek-ai/node-addon-system-linux-arm64',
  '@deepseek-ai/node-addon-system-linux-x64',
])
const LIBREOFFICE_KIT_PACKAGE = '@deepseek-ai/libreoffice-kit'
const LIBREOFFICE_PACKAGES = new Set([
  LIBREOFFICE_KIT_PACKAGE,
  '@deepseek-ai/libreoffice-kit-wasm',
  '@deepseek-ai/libreoffice-kit-darwin-arm64',
  '@deepseek-ai/libreoffice-kit-darwin-x64',
  '@deepseek-ai/libreoffice-kit-win32-arm64',
  '@deepseek-ai/libreoffice-kit-win32-x64',
])

/**
 * Metadata overrides where the installed manifest is wrong or unreachable.
 * Each entry documents why the store cannot answer.
 */
const OVERRIDES: Record<string, { license?: string; repo?: string }> = {
  // Rust workspaces publishing npm bins without `license` in package.json.
  'oxlint': { license: 'MIT', repo: 'https://github.com/oxc-project/oxc' },
  'oxlint-tsgolint': { license: 'MIT', repo: 'https://github.com/oxc-project/tsgolint' },
  // `license: SEE LICENSE IN LICENSE`: the servers repo is mid MIT→Apache-2.0
  // relicensing, so the effective terms are per-contribution.
  '@modelcontextprotocol/server-everything': { license: 'MIT / Apache-2.0', repo: 'https://github.com/modelcontextprotocol/servers' },
  '@modelcontextprotocol/server-filesystem': { license: 'MIT / Apache-2.0', repo: 'https://github.com/modelcontextprotocol/servers' },
  // No repository field in the published manifest.
  'node-addon-require-builtin': { repo: 'https://www.npmjs.com/package/node-addon-require-builtin' },
  // No `license` field in the published manifest; the tarball's LICENSE.txt is the MIT text.
}

/**
 * Python metadata is recorded from the distributions' license and project
 * fields; generation does not require installing their wheels. The bundled Python
 * runtime lock rejects names absent from this map.
 */
const PYTHON_METADATA: Record<string, { license: string; repo: string; role?: string }> = {
  'et-xmlfile': { license: 'MIT', repo: 'https://foss.heptapod.net/openpyxl/et_xmlfile' },
  lxml: { license: 'BSD-3-Clause', repo: 'https://github.com/lxml/lxml' },
  numpy: { license: 'BSD-3-Clause', repo: 'https://github.com/numpy/numpy' },
  openpyxl: { license: 'MIT', repo: 'https://foss.heptapod.net/openpyxl/openpyxl' },
  pandas: { license: 'BSD-3-Clause', repo: 'https://github.com/pandas-dev/pandas' },
  pillow: { license: 'MIT-CMU', repo: 'https://github.com/python-pillow/Pillow' },
  'python-dateutil': { license: 'Apache-2.0 OR BSD-3-Clause', repo: 'https://github.com/dateutil/dateutil' },
  'python-docx': { license: 'MIT', repo: 'https://github.com/python-openxml/python-docx' },
  'python-pptx': { license: 'MIT', repo: 'https://github.com/scanny/python-pptx' },
  six: { license: 'MIT', repo: 'https://github.com/benjaminp/six' },
  'typing-extensions': { license: 'PSF-2.0', repo: 'https://github.com/python/typing_extensions' },
  tzdata: { license: 'Apache-2.0', repo: 'https://github.com/python/tzdata' },
  xlsxwriter: { license: 'BSD-2-Clause', repo: 'https://github.com/jmcnamara/XlsxWriter' },
}

type PythonMetadata = typeof PYTHON_METADATA

/** The `package.json` fields this generator reads. */
export interface Manifest {
  name?: string
  version?: string
  private?: boolean
  license?: string
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}

/** One disclosed external npm dependency. */
interface ExternalDep {
  name: string
  license: string
  repo: string
  /** True when some shipped workspace consumer reaches it through runtime dependency edges. */
  runtime: boolean
}

/** Read and parse a workspace-relative `package.json`. */
function readManifest(rel: string): Manifest {
  return JSON.parse(readFileSync(resolve(root, rel), 'utf8')) as Manifest
}

/**
 * Manifest globs, derived from the workspace declarations rather than listed
 * here, so a new member area (`tools/*`) is read the day it is declared.
 * @returns one glob per manifest-bearing location, repository-relative.
 */
export function manifestPatterns(rootMembers: readonly string[]): string[] {
  return [
    'package.json',
    ...rootMembers.map(member => `${member}/package.json`),
  ]
}

/** The `packages:` member globs declared by one pnpm workspace file. */
function workspaceMembers(rel: string): string[] {
  const declared = (yaml.load(readFileSync(resolve(root, rel), 'utf8')) as { packages?: unknown }).packages
  if (!Array.isArray(declared) || declared.length === 0) {
    throw new Error(`gen-third-party-notices: ${rel} declares no workspace members; the manifest set cannot be derived.`)
  }
  return declared.map(member => String(member))
}

/**
 * Every workspace manifest, keyed by repository-relative path, plus the set of
 * workspace package names. Paths are normalized to `/` at ingestion: Node's
 * `fs.globSync` returns OS-native separators, and the area matching in
 * `tierExternalDeps` compares `/`-suffixed prefixes, so Windows backslashes
 * would silently push dev-area manifests into the runtime tier.
 */
function loadWorkspaceManifests(): { manifests: Map<string, Manifest>; names: Set<string> } {
  const patterns = manifestPatterns(workspaceMembers('pnpm-workspace.yaml'))
  const manifests = new Map<string, Manifest>()
  const names = new Set<string>()
  for (const pattern of patterns) {
    for (const path of globSync(pattern, { cwd: root })) {
      const normalized = path.replaceAll('\\', '/')
      const manifest = readManifest(normalized)
      manifests.set(normalized, manifest)
      if (manifest.name !== undefined) names.add(manifest.name)
    }
  }
  if (manifests.size < 100) throw new Error(`gen-third-party-notices: only ${manifests.size} workspace manifests found; the glob set is stale.`)
  return { manifests, names }
}

type VirtualManifest = Manifest & {
  license?: string
  repository?: string | { url?: string }
  homepage?: string
}

/**
 * Resolve one package's manifest inside a pnpm virtual store. The prefix scan
 * matches ordinary `@scope+name@version` directory names; pnpm 11 truncates
 * long names (a peer-suffixed name past the length limit becomes
 * `<prefix>_<hash>`), so a content scan falls back over the whole store when
 * the prefix misses.
 *
 * @param virtual - the `.pnpm` virtual store directory to scan.
 * @param name - the external package name, exactly as `node_modules` spells it.
 * @param expectedVersion - exact version required when the store retains more than one.
 * @returns the parsed manifest, or `undefined` when neither the prefix match
 *   nor the content scan finds the requested package version.
 */
export function virtualManifest(
  virtual: string,
  name: string,
  expectedVersion?: string,
): VirtualManifest | undefined {
  const prefix = `${name.replace('/', '+')}@`
  const entries = readdirSync(virtual)
  for (const entry of entries.filter(dir => dir.startsWith(prefix))) {
    const manifest = JSON.parse(readFileSync(resolve(virtual, entry, 'node_modules', name, 'package.json'), 'utf8')) as VirtualManifest
    if (expectedVersion === undefined || manifest.version === expectedVersion) return manifest
  }
  for (const dir of entries) {
    const candidate = resolve(virtual, dir, 'node_modules', name, 'package.json')
    if (existsSync(candidate)) {
      const manifest = JSON.parse(readFileSync(candidate, 'utf8')) as VirtualManifest
      if (expectedVersion === undefined || manifest.version === expectedVersion) return manifest
    }
  }
  return undefined
}

const workspaceLinkedManifestCache = new Map<string, VirtualManifest | undefined>()

/**
 * Resolve the package version selected for a declaring workspace instead of an
 * unrelated historical version that still occupies the shared virtual store.
 * @param name - external package identity.
 * @param manifests - workspace manifests already loaded by the caller, so one
 *   load serves every dependency instead of a full re-read per name.
 * @returns the first current workspace link for that package, when installed.
 */
function workspaceLinkedManifest(name: string, manifests: Map<string, Manifest>): VirtualManifest | undefined {
  if (workspaceLinkedManifestCache.has(name)) return workspaceLinkedManifestCache.get(name)
  for (const [path, manifest] of manifests) {
    if (!ALL_KINDS.some(kind => name in (manifest[kind] ?? {}))) continue
    const linked = resolve(root, dirname(path), 'node_modules', name, 'package.json')
    if (!existsSync(linked)) continue
    const found = JSON.parse(readFileSync(linked, 'utf8')) as VirtualManifest
    workspaceLinkedManifestCache.set(name, found)
    return found
  }
  workspaceLinkedManifestCache.set(name, undefined)
  return undefined
}

/** Resolve one installed external package manifest from either pnpm store. */
function installedManifest(name: string, manifests: Map<string, Manifest>, expectedVersion?: string): VirtualManifest | undefined {
  const linked = workspaceLinkedManifest(name, manifests)
  if (linked !== undefined && (expectedVersion === undefined || linked.version === expectedVersion)) return linked
  let manifest: (Manifest & { license?: string; repository?: string | { url?: string }; homepage?: string }) | undefined
  // Workspace-local link farms can expose a dependency that is not linked at
  // the repository root; both are backed by the root workspace's lockfile.
  for (const store of ['node_modules', 'native/system/node_modules']) {
    const direct = resolve(root, store, name, 'package.json')
    if (existsSync(direct)) {
      const candidate = JSON.parse(readFileSync(direct, 'utf8')) as typeof manifest
      if (expectedVersion === undefined || candidate?.version === expectedVersion) {
        manifest = candidate
        break
      }
    }
    const virtual = resolve(root, store, '.pnpm')
    if (!existsSync(virtual)) continue
    manifest = virtualManifest(virtual, name, expectedVersion)
    if (manifest !== undefined) break
  }
  return manifest
}

/** License and repository URL for an installed external package, from the pnpm store. */
function installedMetadata(name: string, manifests: Map<string, Manifest>): { license: string; repo: string } {
  const override = OVERRIDES[name]
  const manifest = installedManifest(name, manifests)
  const license = override?.license ?? manifest?.license
  const rawRepo = typeof manifest?.repository === 'string' ? manifest.repository : manifest?.repository?.url ?? manifest?.homepage
  const repo = override?.repo ?? normalizeRepo(rawRepo)
  if (license === undefined || repo === undefined) {
    throw new Error(`gen-third-party-notices: cannot resolve ${license === undefined ? 'license' : 'repository'} for ${name}; run \`pnpm install\`, or add an OVERRIDES entry.`)
  }
  return { license, repo }
}

/** Normalize a manifest repository/homepage value to a browsable https URL. */
function normalizeRepo(raw: string | undefined): string | undefined {
  if (raw === undefined || raw === '') return undefined
  let url = raw
    .replace(/^git\+ssh:\/\/git@/, 'https://')
    .replace(/^git\+/, '')
    .replace(/^git:\/\//, 'https://')
    .replace(/^github:/, 'https://github.com/')
    .replace(/\.git$/, '')
  if (!url.startsWith('http')) url = `https://github.com/${url}`
  return url
}

/**
 * Direct npm dependencies distributed through installed runtime libraries or
 * browser builds. Tooling declarations alone do not imply distribution.
 */
function collectNpmDeps(manifests: Map<string, Manifest>, names: Set<string>, browser: ReadonlySet<string>): ExternalDep[] {
  return [...tierExternalDeps(manifests, names, browser)]
    .filter(([name]) => !FIRST_PARTY.has(name))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, runtime]) => ({ name, ...installedMetadata(name, manifests), runtime }))
}

/**
 * Tier every external dependency the workspace declares.
 * @param manifests - workspace manifests keyed by repository-relative path.
 * @param names - every workspace package name, which never counts as external.
 * @param browser - Direct third-party packages resolved by the browser builds.
 * @returns each external package mapped to whether it is a runtime dependency.
 */
export function tierExternalDeps(
  manifests: Map<string, Manifest>, names: Set<string>, browser: ReadonlySet<string> = new Set(),
): Map<string, boolean> {
  const tiers = new Map<string, boolean>()
  // `tsx` is runtime by fiat: the root source-run scripts execute through its ESM hook.
  tiers.set('tsx', true)
  for (const [path, manifest] of manifests) {
    const devOnly = DEV_ONLY_AREAS.some(area => (area.endsWith('/') ? path.startsWith(area) : path === area))
    for (const kind of ALL_KINDS) {
      for (const [dep, range] of Object.entries(manifest[kind] ?? {})) {
        if (names.has(dep) || range.startsWith('workspace:')) continue
        const runtime = browser.has(dep) || !devOnly && (RUNTIME_KINDS as readonly string[]).includes(kind)
        tiers.set(dep, (tiers.get(dep) ?? false) || runtime)
      }
    }
  }
  for (const name of browser) {
    if (!names.has(name) && !tiers.has(name)) throw new Error(`gen-third-party-notices: browser package ${name} has no workspace dependency declaration`)
  }
  return tiers
}

/** A vendored package row parsed out of the `vendor/README.md` manifest table. */
export interface VendoredRow {
  npmName: string
  /** The name this package carries upstream; MIT attribution names the fork's origin, not our scope. */
  upstreamName: string
  upstream: string
}

/**
 * Parse the vendored-package manifest table out of `vendor/README.md`.
 * @param text - the complete `vendor/README.md` contents.
 * @returns one row per manifest-table entry, in table order.
 */
export function parseVendoredRows(text: string): VendoredRow[] {
  const rows: VendoredRow[] = []
  for (const line of text.split('\n')) {
    const match = new RegExp(String.raw`^\| \x60\S+\/\x60 \| \x60([^\x60]+)\x60 \| \x60([^\x60]+)\x60 \| \S+ \| `
      + String.raw`(https:\/\/\S+?)(?: \([^)]*\))? \| \x60[0-9a-f]+\x60 \|$`).exec(line)
    if (match === null) continue
    const [, npmName, upstreamName, upstream] = match
    if (npmName === undefined || upstreamName === undefined || upstream === undefined) continue
    rows.push({ npmName, upstreamName, upstream })
  }
  return rows
}

/**
 * Parse the vendored manifest table and confirm it accounts for every vendored
 * directory. The `vendor/` tree — not the table — is the set that must be
 * disclosed, so a row that stops matching the table format is a hard error
 * rather than a package that quietly vanishes from the notices.
 */
function collectVendored(): (VendoredRow & { sourceDirectory: string })[] {
  const rows = parseVendoredRows(readFileSync(resolve(root, 'vendor/README.md'), 'utf8'))
  const onDisk = new Map<string, string>()
  for (const entry of readdirSync(resolve(root, 'vendor'), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const manifest = readManifest(`vendor/${entry.name}/package.json`)
    if (manifest.name !== undefined) onDisk.set(manifest.name, entry.name)
  }

  const parsed = new Set(rows.map(row => row.npmName))
  const missing = [...onDisk.keys()].filter(name => !parsed.has(name))
  if (missing.length > 0) {
    throw new Error(`gen-third-party-notices: vendor/README.md has no manifest-table row for ${missing.join(', ')}; its table format changed or the sync is incomplete.`)
  }
  return rows.map((row) => {
    const dir = onDisk.get(row.npmName)
    if (dir === undefined) throw new Error(`gen-third-party-notices: vendored package ${row.npmName} from vendor/README.md has no vendor/ directory.`)
    const license = readManifest(`vendor/${dir}/package.json`).license
    if (license !== 'MIT') {
      throw new Error(`gen-third-party-notices: vendored ${row.npmName} declares license ${JSON.stringify(license)}; the vendored section assumes MIT throughout.`)
    }
    return { ...row, sourceDirectory: `vendor/${dir}` }
  })
}

/** Normalize a Python distribution name according to the packaging name rule. */
function normalizePythonDistributionName(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, '-')
}

/**
 * Disclose every bundled wheel distribution using its locked version, rejecting duplicate normalized names.
 * @param packages - Distribution names and exact versions from the shared runtime lock.
 * @param metadata - License and source metadata for every locked distribution.
 * @returns Normalized, sorted distribution identities with versions and licenses.
 */
export function collectBundledPythonDependencies(
  packages: Readonly<Record<string, string>>,
  metadata: PythonMetadata = PYTHON_METADATA,
): { name: string; version: string; license: string; repo: string }[] {
  const normalized = new Map<string, string>()
  for (const [distribution, version] of Object.entries(packages)) {
    const name = normalizePythonDistributionName(distribution)
    const previous = normalized.get(name)
    if (previous !== undefined && previous !== version) {
      throw new Error(`gen-third-party-notices: bundled Python distribution ${name} has conflicting locked versions.`)
    }
    if (previous !== undefined) throw new Error(`gen-third-party-notices: bundled Python distribution ${name} has duplicate normalized names.`)
    normalized.set(name, version)
  }
  return [...normalized].sort(([a], [b]) => a.localeCompare(b)).map(([name, version]) => {
    const entry = metadata[name]
    if (entry === undefined) throw new Error(`gen-third-party-notices: bundled Python distribution ${name} is missing from PYTHON_METADATA.`)
    return { name, version, license: entry.license, repo: entry.repo }
  })
}

/** pnpm-patched external packages, from `pnpm-workspace.yaml`. */
function collectPatched(): { spec: string; patch: string }[] {
  const workspace = yaml.load(readFileSync(resolve(root, 'pnpm-workspace.yaml'), 'utf8')) as { patchedDependencies?: Record<string, string> }
  return Object.entries(workspace.patchedDependencies ?? {}).map(([spec, patch]) => ({ spec, patch }))
}

/** SPDX identifiers this project may ship without further review. */
const PERMISSIVE_LICENSES = new Set(['MIT', 'MIT-CMU', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', '0BSD', 'Unlicense', 'CC0-1.0', 'BlueOak-1.0.0', 'Python-2.0', 'PSF-2.0'])

/** Evaluate a parsed SPDX expression under the repository's license policy. */
function isPermissiveSpdx(expression: ReturnType<typeof parseSpdx>): boolean {
  if ('conjunction' in expression) {
    return expression.conjunction === 'and'
      ? isPermissiveSpdx(expression.left) && isPermissiveSpdx(expression.right)
      : isPermissiveSpdx(expression.left) || isPermissiveSpdx(expression.right)
  }
  return expression.plus !== true
    && expression.exception === undefined
    && PERMISSIVE_LICENSES.has(expression.license)
}

/**
 * Whether an SPDX expression grants terms this project may ship under.
 * `OR` needs one permissive alternative, because the consumer chooses; `AND`
 * needs all of them, because every obligation applies. Anything that is not a
 * recognized permissive identifier — copyleft, an exception clause, or a
 * license this list has never seen — evaluates to false, so an unfamiliar
 * expression fails closed rather than passing on a partial match.
 * @param license - the SPDX expression from the package manifest.
 * @returns true when the expression's obligations are all permissive.
 */
export function isPermissive(license: string): boolean {
  // Some npm manifests use a slash for a choice despite SPDX requiring `OR`.
  const normalized = license.replace(/\s*\/\s*/g, ' OR ').trim()
  try {
    return isPermissiveSpdx(parseSpdx(normalized))
  } catch {
    return false
  }
}

/**
 * Reject unapproved non-permissive licenses on installed or browser-bundled code.
 * @param dependencies - Disclosed runtime package identities and declared licenses.
 * @throws When a runtime package has no permissive license or exact owner authorization.
 */
export function assertRuntimeLicenses(dependencies: readonly { name: string; license: string }[]): void {
  const rejected = dependencies.filter(dep => !isPermissive(dep.license)
    && !(LIBREOFFICE_PACKAGES.has(dep.name) && dep.license === 'MPL-2.0'))
  if (rejected.length > 0) {
    throw new Error(`gen-third-party-notices: runtime ${rejected.map(dep => `${dep.name} (${dep.license})`).join(', ')} is not a permissive license; review the distribution terms and record the decision before regenerating.`)
  }
}

/**
 * Render the sentence that isolates non-permissive development tooling, or
 * nothing at all when every development dependency is permissive.
 * @param deps - development dependencies whose license is not permissive.
 * @returns the paragraph to place after the development table.
 */
function renderNonPermissiveNote(deps: ExternalDep[]): string {
  if (deps.length === 0) return ''
  const named = deps.map(dep => `\`${dep.name}\` (${dep.license})`)
  const subject = named.length === 1 ? named[0] : `${named.slice(0, -1).join(', ')} and ${named.at(-1)}`
  return `\n${subject} ${named.length === 1 ? 'runs' : 'run'} only as development tooling; their code is not linked into or distributed with any DeepSeek Harness artifact.\n`
}

/** Render one npm dependency table. */
function renderNpmTable(deps: ExternalDep[]): string {
  const lines = ['| Package | License |', '| --- | --- |']
  for (const dep of deps) lines.push(`| [\`${dep.name}\`](${dep.repo}) | ${dep.license} |`)
  return lines.join('\n')
}

/**
 * Render the complete notices document.
 * @returns The exact bytes THIRD_PARTY_NOTICES.md must hold after resolving browser inputs.
 */
export async function render(): Promise<string> {
  const browser = await browserBundledExternals(root)
  // The linked-manifest cache is keyed by name only, so it must not outlive
  // the manifests map it was resolved from; render() owns that single load.
  workspaceLinkedManifestCache.clear()
  const { manifests, names } = loadWorkspaceManifests()
  const npm = collectNpmDeps(manifests, names, browser)
  const runtimeDeps = npm.filter(dep => dep.runtime)
  const devDeps = npm.filter(dep => !dep.runtime)
  const kitRuntime = runtimeDeps.some(dep => dep.name === LIBREOFFICE_KIT_PACKAGE)
  const vendored = collectVendored()
  const bundledPython = collectBundledPythonDependencies(primaryRuntimeLock.pythonPackages)
  const patched = collectPatched()
  const nonPermissiveDev = devDeps.filter(dep => !isPermissive(dep.license))
  assertRuntimeLicenses(runtimeDeps)
  assertRuntimeLicenses(bundledPython)
  const patchedLines = patched.map(({ spec, patch }) => `- \`${spec}\` — [\`${patch}\`](${patch})`)

  return `<!-- Generated by scripts/gen-third-party-notices.ts — do not edit by hand.
     Run \`pnpm run gen-third-party-notices\` to regenerate. -->

# Third-Party Notices

DeepSeek Harness is licensed under [MIT](LICENSE). It depends on the third-party software listed below. Each project remains under its own license; nothing in this file changes those terms.

This file lists **direct** dependencies declared by the workspace and the Bundled Python distributions. It is generated by \`scripts/gen-third-party-notices.ts\`, and \`scripts/gen-third-party-notices.spec.ts\` asserts in the test lane that the committed bytes match. Run \`pnpm run gen-third-party-notices\` after changing one of its inputs, or \`pnpm run verify-third-party-notices\` for the standalone check.

The complete npm transitive closure, including the Landlock launcher workspace, is recorded with exact pinned versions in [\`pnpm-lock.yaml\`](pnpm-lock.yaml) — inspect it with \`pnpm licenses list\`.

## Vendored source (\`vendor/\`)

The Cordis framework and its foundation libraries are source-vendored into this repository rather than consumed from npm, and republished under the \`@deepseek-ai\` scope. All are MIT-licensed; each directory preserves its upstream \`LICENSE\` file. Exact upstream commits and local modifications are recorded in [\`vendor/README.md\`](vendor/README.md).

| Package | Upstream name | Source | License |
| --- | --- | --- | --- |
${vendored.map(row => `| \`${row.npmName}\` | \`${row.upstreamName}\` | [${row.sourceDirectory}](${row.sourceDirectory}/) | MIT |`).join('\n')}

## Runtime npm dependencies

External packages installed for runtime use or distributed inside the prebuilt browser artifacts. Browser inputs are resolved through the shipping tsdown and Vite configurations, independently of npm dependency sections. The tier covers every plugin a user can mount from \`cordis.yml\` — not only what the \`dsh\` CLI and Web UI load by default.

${renderNpmTable(runtimeDeps)}

pnpm applies local patches to the following packages at install time, so shipped artifacts carry modified copies; each patch file is the complete record of the modification:

${patchedLines.join('\n')}

${kitRuntime ? `
## LibreOffice conversion kit

${[...LIBREOFFICE_PACKAGES].map(name => `\`${name}\``).join(', ')} declare MPL-2.0, which remains outside the permissive-license allowlist; the notices check accepts only these package identities at those terms. The [distribution decision](.agents/notes/implemented/architecture/2026-09-14-independent-libreoffice-kit.md) records the source obligations.

The [kit repository](https://github.com/deepseek-ai/dsh-libreoffice-kit) supplies the corresponding LibreOffice source pin, modifications, build instructions, Node API, and artifact validation. Its engine packages retain their license and third-party notices; the Node API retains its MPL-2.0 declaration and NOTICE. Recipients must have access to those corresponding sources and notices.
` : ''}

## Development-only npm dependencies

External packages **directly declared** for development, tests, types, or tooling, without a runtime installation or browser-build relationship. A package here may still be pulled in transitively by a runtime dependency — \`pnpm-lock.yaml\` is the authority on that full closure.

${renderNpmTable(devDeps)}
${renderNonPermissiveNote(nonPermissiveDev)}
## Bundled Python distributions

The [shared runtime lock](scripts/primary-runtime/lock.json) records each distribution version and the wheel download hashes. The table includes every entry in \`pythonPackages\`, including transitive dependencies. Wheel extraction preserves distribution metadata and the license and notice files supplied by each archive. Project licenses below do not enumerate the separate licenses of native libraries bundled inside wheels.

| Distribution | Locked version | Project license |
| --- | --- | --- |
${bundledPython.map(dep => `| [\`${dep.name}\`](${dep.repo}) | ${dep.version} | ${dep.license} |`).join('\n')}

## First-party native packages

\`@deepseek-ai/node-addon-system\` (and its platform packages) is built and released from this repository under BSD 3-Clause. It is listed here for completeness; it is first-party, not third-party.
`
}

/** CLI entry: default writes the notices, `--check` fails if the committed copy
 * is stale. Guarded behind an entry-point check so importing this module for
 * tests neither regenerates the committed file nor calls process.exit. */
async function main(): Promise<void> {
  const content = await render()
  if (process.argv.includes('--check')) {
    let committed: string | null = null
    try {
      committed = readFileSync(resolve(root, OUT), 'utf8')
    } catch {
      // Only ENOENT (not yet generated) is expected; a present-but-unreadable
      // file is not a state this repo produces, and the remedy is the same.
      committed = null
    }
    if (committed === content) {
      console.log(`gen-third-party-notices: ${OUT} is up to date.`)
      process.exit(0)
    }
    console.error(`gen-third-party-notices: ${OUT} is stale. Run \`pnpm run gen-third-party-notices\` and commit ${OUT}.`)
    process.exit(1)
  }

  writeFileSync(resolve(root, OUT), content)
  console.log(`gen-third-party-notices: wrote ${OUT}.`)
}

if (process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1])) {
  await main()
}
