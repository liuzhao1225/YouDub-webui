import { execFileSync } from 'node:child_process'
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sha256, tree } from './tree.mjs'

const repo = fileURLToPath(new URL('../../../', import.meta.url))
const here = fileURLToPath(new URL('.', import.meta.url))
const destination = join(repo, 'vendor/deepseek-harness')
const manifestPath = join(destination, 'source-manifest.json')
const sourcePath = join(destination, 'source')
const sources = JSON.parse(await readFile(join(here, 'sources.json'), 'utf8'))
const npm = JSON.parse(await readFile(join(here, 'npm-packages.json'), 'utf8'))
const source = sources.sources.find(value => value.version === '0.2.1-rc.2')
const args = process.argv.slice(2)
if (args.some(value => !['--copy', '--complete', '--verify'].includes(value)) || args.length > 1) throw new Error('Usage: node apps/harness/baselines/vendor.mjs [--copy|--complete|--verify]')
const same = (actual, expected, message) => { if (actual !== expected) throw new Error(`${message}: expected ${expected}, received ${actual}`) }

if (args.includes('--copy')) {
  const archive = join(sources.baselineRoot, source.archive)
  const archiveRecord = sources.artifacts.find(value => value.path === source.archive)
  same(await sha256(archive), archiveRecord.sha256, 'Original source archive SHA-256')
  try { await lstat(sourcePath); throw new Error(`Refusing to replace existing upstream source: ${sourcePath}`) }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  const temporary = await mkdtemp(join(tmpdir(), 'youdub-harness-source-'))
  try {
    execFileSync('tar', ['-xzf', archive, '-C', temporary], { stdio: 'pipe' })
    const packages = new Map()
    for (const prefix of ['apps', 'packages', 'vendor', 'native/system']) {
      async function discover(relative, depth) {
        if (depth > 2) return
        const entries = await readdir(join(temporary, relative), { withFileTypes: true })
        if (entries.some(entry => entry.name === 'package.json')) {
          const manifest = JSON.parse(await readFile(join(temporary, relative, 'package.json'), 'utf8'))
          if (manifest.name) packages.set(manifest.name, { path: relative, manifest })
        }
        for (const entry of entries) if (entry.isDirectory()) await discover(`${relative}/${entry.name}`, depth + 1)
      }
      await discover(prefix, 0)
    }
    const roots = new Set(npm.packages.filter(value => value.name.startsWith('@deepseek-ai/')).map(value => value.name))
    for (const name of ['@deepseek-ai/dsh-desktop', '@deepseek-ai/dsh-desktop-host', '@deepseek-ai/dsh-web-frontend']) roots.add(name)
    for (const name of Object.keys(packages.get('@deepseek-ai/dsh-desktop').manifest.devDependencies)) if (name.startsWith('@deepseek-ai/')) roots.add(name)
    const pending = [...roots], selected = new Set()
    while (pending.length) {
      const name = pending.pop()
      if (selected.has(name) || !packages.has(name)) continue
      selected.add(name)
      const manifest = packages.get(name).manifest
      // Published bundles inline several devDependencies (notably client-web and
      // ui-dockkit). Include their unchanged source for a source-based build.
      for (const kind of ['dependencies', 'optionalDependencies', 'peerDependencies', 'devDependencies']) pending.push(...Object.keys(manifest[kind] ?? {}))
    }
    const paths = new Set([...selected].map(name => packages.get(name).path))
    for (const path of ['scripts', 'packages/client/tsdown.client.ts', 'native/system', 'python', 'patches', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.base.client.json', 'tsconfig.base.json', 'tsconfig.client.json', 'tsconfig.host.json', 'tsconfig.json', 'tsconfig.node.base.json', 'tsdown.config.ts']) paths.add(path)
    const included = [...paths].sort().filter(path => ![...paths].some(parent => path.startsWith(parent + '/')))
    await mkdir(sourcePath, { recursive: true })
    for (const path of included) {
      await mkdir(dirname(join(sourcePath, path)), { recursive: true })
      await cp(join(temporary, path), join(sourcePath, path), { recursive: true, preserveTimestamps: true, verbatimSymlinks: true })
    }
    const current = await tree(sourcePath)
    const manifest = {
      formatVersion: 1,
      upstreamUrl: sources.upstreamUrl,
      tag: source.tag,
      commit: source.commit,
      gitTree: source.tree,
      archiveSha256: archiveRecord.sha256,
      selection: 'Installed official package sources and their runtime/build dependency closure, Desktop/Web/Host entries, and unchanged upstream build support.',
      includedPaths: included,
      packages: [...selected].sort().map(name => ({ name, version: packages.get(name).manifest.version, path: packages.get(name).path, root: roots.has(name) })),
      externalPublishedPackages: [...roots].filter(name => !packages.has(name)).sort().map(name => ({ name, artifacts: npm.packages.filter(value => value.name === name).map(({ version, resolved, integrity, artifact, artifactSha256 }) => ({ version, resolved, integrity, artifact, artifactSha256 })) })),
      installedDesktopBinary: { version: sources.desktop.version, buildCommit: sources.desktop.buildCommit, sourceAvailable: sources.desktop.sourceAvailable, limitation: sources.desktop.sourceRetrievalError },
      ...current,
    }
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

let manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
if (args.includes('--complete')) {
  // The aggregate upstream compiler references build-only packages beyond the
  // installed runtime dependency graph. Add their original source unchanged.
  const before = await tree(sourcePath)
  same(before.sha256, manifest.sha256, 'Existing upstream source before completing build inputs')
  const archive = join(sources.baselineRoot, source.archive)
  same(await sha256(archive), manifest.archiveSha256, 'Original source archive SHA-256')
  const temporary = await mkdtemp(join(tmpdir(), 'youdub-harness-complete-'))
  try {
    execFileSync('tar', ['-xzf', archive, '-C', temporary], { stdio: 'pipe' })
    for (const path of ['apps', 'packages', 'vendor']) {
      await cp(join(temporary, path), join(sourcePath, path), { recursive: true, preserveTimestamps: true, verbatimSymlinks: true })
    }
    const paths = new Set([...manifest.includedPaths, 'apps', 'packages', 'vendor'])
    const included = [...paths].sort().filter(path => ![...paths].some(parent => path.startsWith(parent + '/')))
    const packages = []
    async function discover(relative, depth) {
      if (depth > 2) return
      const entries = await readdir(join(sourcePath, relative), { withFileTypes: true })
      if (entries.some(entry => entry.name === 'package.json')) {
        const value = JSON.parse(await readFile(join(sourcePath, relative, 'package.json'), 'utf8'))
        if (value.name) packages.push({ name: value.name, version: value.version, path: relative,
          root: manifest.packages.some(record => record.name === value.name && record.root) })
      }
      for (const entry of entries) if (entry.isDirectory()) await discover(`${relative}/${entry.name}`, depth + 1)
    }
    for (const prefix of ['apps', 'packages', 'vendor', 'native/system']) await discover(prefix, 0)
    const current = await tree(sourcePath)
    manifest = { ...manifest, selection: 'Complete upstream apps, packages, vendor packages and unchanged build support required by the official Host/Client/Web build graph.',
      includedPaths: included, packages: packages.sort((a, b) => a.name.localeCompare(b.name)), ...current }
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
  } finally { await rm(temporary, { recursive: true, force: true }) }
}
same(manifest.commit, source.commit, 'Vendored revision')
const current = await tree(sourcePath)
const expected = new Map(manifest.entries.map(entry => [entry.path, entry]))
for (const entry of current.entries) {
  const original = expected.get(entry.path)
  if (!original) throw new Error(`Added file in immutable upstream source: ${entry.path}`)
  same(JSON.stringify(entry), JSON.stringify(original), `Upstream file changed: ${entry.path}`)
  expected.delete(entry.path)
}
if (expected.size) throw new Error(`Missing upstream source file: ${expected.keys().next().value}`)
same(current.sha256, manifest.sha256, 'Upstream source tree SHA-256')
same(current.files, manifest.files, 'Upstream source file count')
console.log(JSON.stringify({ passed: true, sourcePath: resolve(sourcePath), commit: manifest.commit, packages: manifest.packages.length, files: current.files, sha256: current.sha256, externalPublishedPackages: manifest.externalPublishedPackages.map(value => value.name), installedDesktopExactBuildSourceAvailable: manifest.installedDesktopBinary.sourceAvailable }, null, 2))
