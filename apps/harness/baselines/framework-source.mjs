/** Immutable upstream evidence and the reviewed, mutable YouDub framework fork. */
import { execFileSync } from 'node:child_process'
import { copyFile, lstat, mkdir, readFile, readlink, rm, symlink, chmod } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sha256, tree } from './tree.mjs'

const repository = fileURLToPath(new URL('../../../', import.meta.url))
const same = (actual, expected, message) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(message)
}

/** Exact changes, including modes and link targets; reasons live in the reviewed ledger. */
export function sourceChanges(original, current) {
  const before = new Map(original.entries.map(entry => [entry.path, entry]))
  const after = new Map(current.entries.map(entry => [entry.path, entry]))
  return [...new Set([...before.keys(), ...after.keys()])].sort().flatMap(path => {
    const old = before.get(path) ?? null, next = after.get(path) ?? null
    return JSON.stringify(old) === JSON.stringify(next) ? [] : [{ path, before: old, after: next }]
  })
}

export function verifyChanges(original, current, changes) {
  if (!Array.isArray(changes)) throw new Error('Framework fork changes must be an array')
  for (const entry of changes) {
    if (typeof entry.reason !== 'string' || !entry.reason.trim()) throw new Error(`Missing fork change reason: ${entry.path}`)
  }
  same(sourceChanges(original, current), changes.map(({ path, before, after }) => ({ path, before, after })),
    'Framework source differs from the reviewed fork ledger; inspect the diff and record its exact bytes and reason')
}

export async function readFrameworkSource(root = repository) {
  const directory = join(root, 'vendor/deepseek-harness')
  const manifestPath = join(directory, 'source-manifest.json')
  const fork = JSON.parse(await readFile(join(directory, 'fork.json'), 'utf8'))
  if (fork.formatVersion !== 1) throw new Error(`Unsupported framework fork ledger version: ${fork.formatVersion}`)
  same(await sha256(manifestPath), fork.originalManifestSha256, 'The immutable upstream source manifest has changed')
  const original = JSON.parse(await readFile(manifestPath, 'utf8'))
  same(fork.upstreamCommit, original.commit, 'The framework fork and upstream manifest name different commits')
  const source = join(directory, 'source')
  const current = await tree(source)
  verifyChanges(original, current, fork.changes)
  const paths = new Set(current.entries.map(entry => entry.path))
  const packages = []
  for (const entry of original.packages) {
    if (!paths.has(`${entry.path}/package.json`)) continue
    const pkg = JSON.parse(await readFile(join(source, entry.path, 'package.json'), 'utf8'))
    packages.push({ ...entry, name: pkg.name, version: pkg.version })
  }
  return { source, original, fork, ...current, packages }
}

/** A commit identifies history; input hashes also describe uncommitted development changes. */
export function productRevision(root = repository) {
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
  return { commit: git('rev-parse', 'HEAD'), dirty: Boolean(git('status', '--porcelain', '--untracked-files=normal')) }
}

/** Validate only declared inputs; compiled outputs may coexist in the staging workspace. */
export async function assertStagedSource(stage, source) {
  for (const entry of source.entries) {
    const path = join(stage, entry.path), stat = await lstat(path)
    if (entry.type === 'symlink') {
      if (!stat.isSymbolicLink()) throw new Error(`Staged source is no longer a symlink: ${entry.path}`)
      same(await readlink(path), entry.target, `Staged source link differs: ${entry.path}`)
    } else {
      if (!stat.isFile()) throw new Error(`Staged source is no longer a file: ${entry.path}`)
      same(await sha256(path), entry.sha256, `Staged source bytes differ: ${entry.path}`)
      // Windows has no Unix executable permission bits.
      if (process.platform !== 'win32') same(Boolean(stat.mode & 0o111), entry.executable, `Staged source executable mode differs: ${entry.path}`)
    }
  }
}

/** Synchronize known source inputs without following pre-existing links or retaining deleted inputs. */
export async function stageFrameworkSource(source, stage, previousEntries) {
  if (resolve(stage) === resolve(source.source) || resolve(stage).startsWith(resolve(source.source) + sep)) {
    throw new Error('The build workspace must be separate from framework source')
  }
  const paths = new Set(source.entries.map(entry => entry.path))
  for (const entry of previousEntries) {
    if (!paths.has(entry.path)) await rm(join(stage, entry.path), { force: true })
  }
  for (const entry of source.entries) {
    const destination = join(stage, entry.path)
    await mkdir(dirname(destination), { recursive: true })
    try {
      const stat = await lstat(destination)
      if (stat.isSymbolicLink() || entry.type === 'symlink') await rm(destination)
    } catch (error) { if (error.code !== 'ENOENT') throw error }
    if (entry.type === 'symlink') await symlink(entry.target, destination)
    else {
      await copyFile(join(source.source, entry.path), destination)
      await chmod(destination, entry.executable ? 0o755 : 0o644)
    }
  }
  await assertStagedSource(stage, source)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const source = await readFrameworkSource()
  console.log(JSON.stringify({ passed: true, upstreamCommit: source.original.commit,
    originalSourceTreeSha256: source.original.sha256, forkSourceTreeSha256: source.sha256,
    packages: source.packages.length, files: source.files, changes: source.fork.changes.length,
    product: productRevision() }, null, 2))
}
