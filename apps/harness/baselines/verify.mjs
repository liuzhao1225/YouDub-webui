import { execFileSync } from 'node:child_process'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve, join } from 'node:path'
import { sha256, tree } from './tree.mjs'

const here = fileURLToPath(new URL('.', import.meta.url))
const repo = fileURLToPath(new URL('../../../', import.meta.url))
const sources = JSON.parse(await readFile(join(here, 'sources.json'), 'utf8'))
const npm = JSON.parse(await readFile(join(here, 'npm-packages.json'), 'utf8'))
const options = new Map()
const allowed = new Set(['--scope','--baseline-root','--npm-root','--app','--original-source','--report'])
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index], value = process.argv[index + 1]
  if (!allowed.has(key) || !value || value.startsWith('--')) throw new Error(`Invalid argument: ${key}`)
  options.set(key, value)
}
const scope = options.get('--scope') ?? 'all'
if (!['all','sources','desktop','npm','vendor','build'].includes(scope)) throw new Error(`Unknown verification scope: ${scope}`)
const baseline = resolve(options.get('--baseline-root') ?? sources.baselineRoot)
const npmRoot = resolve(options.get('--npm-root') ?? join(here, '..'))
const original = resolve(options.get('--original-source') ?? sources.originalSource.path)
const app = resolve(options.get('--app') ?? sources.desktop.path)
const result = { checkedAt:new Date().toISOString(), scope, passed:false, checks:[] }
const same = (actual, expected, description) => { if (actual !== expected) throw new Error(`${description}: expected ${expected}, received ${actual}`) }
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], {encoding:'utf8',maxBuffer:32*1024*1024}).trim()

async function verifySources() {
  for (const artifact of sources.artifacts) same(await sha256(join(baseline, artifact.path)), artifact.sha256, `Preserved artifact ${artifact.path}`)
  for (const source of sources.sources) {
    const heads = git(repo, 'bundle', 'list-heads', join(baseline, source.bundle))
    same(heads, `${source.commit} refs/tags/${source.tag}`, `Official source bundle ${source.version}`)
    execFileSync('git', ['-C', repo, 'bundle', 'verify', join(baseline, source.bundle)], {stdio:'pipe'})
    same(git(join(baseline,'deepseek-harness.git'), 'rev-parse', `${source.commit}^{tree}`), source.tree, `Official tree ${source.version}`)
  }
  same(git(original, 'rev-parse', 'HEAD'), sources.originalSource.commit, 'Original Harness checkout commit')
  same(git(original, 'status', '--porcelain=v1', '--untracked-files=all'), '', 'Original Harness tracked/untracked source changes')
  same(git(repo, 'rev-parse', `${sources.youdub.sourceSnapshot}^{tree}`), sources.youdub.sourceTree, 'YouDub initial snapshot tree')
  const youdubHeads = git(repo, 'bundle', 'list-heads', join(baseline, sources.youdub.bundle))
  for (const commit of [sources.youdub.sourceSnapshot, sources.youdub.pocCommit]) if (!youdubHeads.split('\n').some(head=>head.startsWith(commit+' '))) throw new Error(`Initial YouDub bundle does not contain ${commit}`)
  execFileSync('git', ['-C', repo, 'bundle', 'verify', join(baseline, sources.youdub.bundle)], {stdio:'pipe'})
  result.checks.push({scope:'sources',officialSnapshots:sources.sources.length,originalCheckoutUnchanged:true,youdubSnapshot:sources.youdub.sourceSnapshot,preservedArtifacts:sources.artifacts.length})
}
async function verifyDesktop() {
  for (const path of [app, join(baseline, sources.desktop.savedCopy)]) {
    const current = await tree(path)
    same(current.sha256, sources.desktop.treeSha256, `Official Desktop entire file tree ${path}`)
    same(current.files, sources.desktop.files, `Official Desktop file count ${path}`)
  }
  result.checks.push({scope:'desktop',app,files:sources.desktop.files,treeSha256:sources.desktop.treeSha256,version:sources.desktop.version,buildCommit:sources.desktop.buildCommit,embeddedBuildSourceAvailable:sources.desktop.sourceAvailable})
}
async function verifyNpm() {
  const lock = JSON.parse(await readFile(join(npmRoot,'package-lock.json'),'utf8'))
  const expected = new Set(npm.packages.map(pkg=>pkg.path))
  for (const pkg of npm.packages) {
    const entry = lock.packages[pkg.path]
    if (!entry) throw new Error(`Official dependency missing from lock: ${pkg.path}`)
    same(entry.version,pkg.version,`Official locked version ${pkg.name}`)
    same(entry.integrity,pkg.integrity,`Official locked integrity ${pkg.name}`)
    same(await sha256(join(baseline,pkg.artifact)),pkg.artifactSha256,`Preserved npm artifact ${pkg.name}`)
    const current = await tree(join(npmRoot,pkg.path),{omitNodeModules:true})
    same(current.sha256,pkg.treeSha256,`Installed official npm bytes/modes/links ${pkg.name}`)
    same(current.files,pkg.files,`Installed official npm file count ${pkg.name}`)
  }
  async function inspectModules(relative) {
    let entries
    try { entries = await readdir(join(npmRoot,relative),{withFileTypes:true}) }
    catch (error) { if (error.code === 'ENOENT') return; throw error }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || !entry.isDirectory() && !entry.isSymbolicLink()) continue
      const names = entry.name.startsWith('@')
        ? (await readdir(join(npmRoot,relative,entry.name))).map(name=>`${entry.name}/${name}`)
        : [entry.name]
      for (const name of names) {
        const path = `${relative}/${name}`
        if (name.startsWith('@deepseek-ai/') && !expected.has(path)) throw new Error(`Installed official package lacks a reviewed baseline: ${path}`)
        await inspectModules(`${path}/node_modules`)
      }
    }
  }
  await inspectModules('node_modules')
  result.checks.push({scope:'npm',npmRoot,packages:npm.packages.length,registryArtifactsVerified:true})
}
function verifyVendor() {
  const checked = JSON.parse(execFileSync(process.execPath, [join(here, 'vendor.mjs'), '--verify'], {encoding:'utf8',maxBuffer:32*1024*1024}))
  result.checks.push({scope:'vendor',...checked})
}
function verifyDesktopBuild() {
  const checked = JSON.parse(execFileSync(process.execPath, [join(here, 'desktop-build.mjs'), '--verify'], {encoding:'utf8',maxBuffer:32*1024*1024}))
  result.checks.push({scope:'build',...checked})
}
try {
  if (scope === 'all' || scope === 'sources') await verifySources()
  if (scope === 'all' || scope === 'desktop') await verifyDesktop()
  if (scope === 'all' || scope === 'npm') await verifyNpm()
  if (scope === 'all' || scope === 'vendor') verifyVendor()
  if (scope === 'all' || scope === 'build') verifyDesktopBuild()
  result.passed = true
} catch (error) {
  result.error = error instanceof Error ? error.message : String(error)
  process.exitCode = 1
}
result.limitations = [sources.desktop.sourceRetrievalError,'This check verifies upstream and baseline integrity. Functional parity requires the separate coverage evidence and application acceptance.']
const serialized = JSON.stringify(result,null,2)+'\n'
if (options.has('--report')) await writeFile(resolve(options.get('--report')),serialized)
console.log(serialized)
