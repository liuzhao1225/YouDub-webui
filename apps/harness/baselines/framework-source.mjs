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
  const actual = sourceChanges(original, current)
  const expected = changes.map(({ path, before, after }) => ({ path, before, after }))
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    const reviewed = new Map(expected.map(entry => [entry.path, entry]))
    const observed = new Map(actual.map(entry => [entry.path, entry]))
    const differences = [...new Set([...reviewed.keys(), ...observed.keys()])].sort().flatMap(path => {
      const expected = reviewed.get(path) ?? null, actual = observed.get(path) ?? null
      return JSON.stringify(expected) === JSON.stringify(actual) ? [] : [{ path, expected, actual }]
    })
    throw new Error(`Framework source differs from the reviewed fork ledger; ${differences.length} mismatched entries. Inspect exact bytes, modes and links: ${JSON.stringify(differences.slice(0, 10))}`)
  }
}

export async function readFrameworkSource(root = repository, { platform = process.platform } = {}) {
  const directory = join(root, 'vendor/deepseek-harness')
  const manifestPath = join(directory, 'source-manifest.json')
  const fork = JSON.parse(await readFile(join(directory, 'fork.json'), 'utf8'))
  if (fork.formatVersion !== 1) throw new Error(`Unsupported framework fork ledger version: ${fork.formatVersion}`)
  same(await sha256(manifestPath), fork.originalManifestSha256, 'The immutable upstream source manifest has changed')
  const original = JSON.parse(await readFile(manifestPath, 'utf8'))
  same(fork.upstreamCommit, original.commit, 'The framework fork and upstream manifest name different commits')
  const source = join(directory, 'source')
  // Windows has no Unix executable bit. Keep checking the tracked Git mode,
  // alongside actual file bytes and links, instead of discarding that metadata.
  let executableModes
  if (platform === 'win32') {
    executableModes = new Map()
    const index = execFileSync('git', ['ls-files', '--stage', '-z'], { cwd: source, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
    for (const entry of index.split('\0').filter(Boolean)) {
      const match = /^(100644|100755|120000) [0-9a-f]+ 0\t(.+)$/s.exec(entry)
      if (!match) throw new Error('Framework source has an unresolved or unsupported Git index entry')
      executableModes.set(match[2], match[1] === '100755')
    }
  }
  const current = await tree(source, { executableModes })
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

/** Package directories retired from the immutable inventory by this fork. */
function retiredPackagePaths(source) {
  const inputs = new Set(source.entries.map(entry => entry.path))
  // An original archive has no fork inventory and therefore no retired packages.
  return (source.original?.packages ?? []).filter(pkg => !inputs.has(`${pkg.path}/package.json`)).map(pkg => pkg.path)
}

/** Validate declared inputs and reject outputs belonging to retired packages. */
export async function assertStagedSource(stage, source) {
  for (const path of retiredPackagePaths(source)) {
    try { await lstat(join(stage, path)) }
    catch (error) { if (error.code === 'ENOENT') continue; throw error }
    throw new Error(`Retired framework package remains in build staging: ${path}; rebuild the framework`)
  }
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
  for (const path of retiredPackagePaths(source)) await rm(join(stage, path), { recursive: true, force: true })
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
