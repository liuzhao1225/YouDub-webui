/** Build inputs for the maintained YouDub subset. Git owns source history. */
import { execFileSync } from 'node:child_process'
import { copyFile, lstat, mkdir, readFile, rm, symlink, chmod } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readLinkTarget, sha256, tree } from './source-tree.mjs'
const repository = fileURLToPath(new URL('../../', import.meta.url))
const same = (actual, expected, message) => { if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(message) }

export async function readFrameworkSource(root = repository) {
  const directory = join(root, 'vendor/deepseek-harness')
  const source = join(directory, 'source')
  const upstream = JSON.parse(await readFile(join(directory, 'upstream.json'), 'utf8'))
  let executableModes
  if (process.platform === 'win32') {
    executableModes = new Map()
    const index = execFileSync('git', ['ls-files', '--stage', '-z'], { cwd: source, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
    for (const entry of index.split('\0').filter(Boolean)) {
      const match = /^(100644|100755|120000) [0-9a-f]+ 0\t(.+)$/s.exec(entry)
      if (!match) throw new Error('Framework source has an unresolved or unsupported Git index entry')
      executableModes.set(match[2], match[1] === '100755')
    }
  }
  const current = await tree(source, { executableModes })
  const packages = []
  for (const entry of current.entries) {
    if (!/^(?:apps\/[^/]+|vendor\/[^/]+|packages\/[^/]+\/[^/]+)\/package\.json$/.test(entry.path)) continue
    const pkg = JSON.parse(await readFile(join(source, entry.path), 'utf8'))
    packages.push({ path: dirname(entry.path), name: pkg.name, version: pkg.version })
  }
  return { source, upstream, ...current, packages }
}

export function productRevision(root = repository) {
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
  return { commit: git('rev-parse', 'HEAD'), dirty: Boolean(git('status', '--porcelain', '--untracked-files=normal')) }
}


export async function assertStagedSource(stage, source) {
  for (const entry of source.entries) {
    const path = join(stage, entry.path), stat = await lstat(path)
    if (entry.type === 'symlink') {
      if (!stat.isSymbolicLink()) throw new Error(`Staged source is no longer a symlink: ${entry.path}`)
      same(await readLinkTarget(path), entry.target, `Staged source link differs: ${entry.path}`)
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
  const retiredSources = new Set()
  for (const entry of previousEntries) {
    if (paths.has(entry.path)) continue
    const match = /^((?:apps\/[^/]+|vendor\/[^/]+|packages\/[^/]+\/[^/]+))\/src\//.exec(entry.path)
    if (match && paths.has(`${match[1]}/package.json`)) retiredSources.add(match[1])
  }
  // TypeScript does not remove old emitted files when an input disappears.
  // Remove that package's outputs and incremental record before rebuilding it.
  for (const directory of retiredSources) await rm(join(stage, directory, 'lib'), { recursive: true, force: true })
  // Remove compiled outputs as well when their source package was retired.
  for (const entry of previousEntries) {
    if (/^(?:apps\/[^/]+|vendor\/[^/]+|packages\/[^/]+\/[^/]+)\/package\.json$/.test(entry.path) && !paths.has(entry.path)) {
      await rm(join(stage, dirname(entry.path)), { recursive: true, force: true })
    }
  }
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
}


if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const source = await readFrameworkSource()
  console.log(JSON.stringify({ upstream: source.upstream, sourceTreeSha256: source.sha256, packages: source.packages.length, files: source.files }, null, 2))
}
