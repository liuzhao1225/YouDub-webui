import { readFile, writeFile, stat, realpath } from 'node:fs/promises'
import { isBuiltin, createRequire } from 'node:module'
import { join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { sha256 } from './tree.mjs'
import { assertStagedSource, readFrameworkSource } from './framework-source.mjs'

const here = fileURLToPath(new URL('..', import.meta.url))
const root = resolve(here, '../..')
const output = join(here, 'dist/desktop')
const source = join(root, 'vendor/deepseek-harness/source')
const compiled = join(root, '.cache/harness/source-build')
const framework = await readFrameworkSource(root)
const manifest = framework.original
const original = new Map(manifest.entries.map(entry => [entry.path, entry]))
const current = new Map(framework.entries.map(entry => [entry.path, entry]))
const records = JSON.parse(await readFile(join(output, 'build-inputs.json'), 'utf8'))
const receiptPath = join(output, 'source-provenance.json')
if (process.argv.slice(2).some(value => !['--record', '--verify'].includes(value)) || process.argv.length > 3) throw new Error('Usage: node apps/harness/baselines/desktop-build.mjs [--record|--verify]')
const require = createRequire(join(output, 'package.json'))
const expected = {
  product: join(here, 'src/desktop-product.ts'),
  developmentProject: 'apps/desktop/scripts/development-project.ts',
}
const normalize = path => path.split(sep).join('/')
const within = (path, directory) => path === directory || path.startsWith(directory + sep)
const same = (left, right, description) => { if (left !== right) throw new Error(`${description}: expected ${right}, received ${left}`) }
const report = { formatVersion: 3, upstreamCommit: manifest.commit, upstreamSourceTreeSha256: manifest.sha256,
  forkSourceTreeSha256: framework.sha256, forkChanges: framework.fork.changes,
  records: {}, copiedAssets: [], productEntry: {}, limitations: [
  'Only files with nonzero bytesInOutput are described as included source inputs. Unused modules are listed separately by count.',
  'This receipt verifies reviewed fork inputs, copied build artifacts, and development dependency resolution. Functional coverage is recorded separately.',
  'The executable uses the npm Electron distribution. Development runs use workspace links and do not create a distributable application.',
] }
for (const [name, entry] of Object.entries(expected)) {
  const record = records[name]
  if (!record) throw new Error(`Missing official source build record: ${name}`)
  const outputs = Object.entries(record.outputs)
  if (!outputs.some(([, value]) => value.entryPoint && resolve(here, value.entryPoint) === (name === 'product' ? entry : join(source, entry)))) throw new Error(`Build ${name} is not rooted at official source ${entry}`)
  const active = new Set(outputs.flatMap(([, value]) => Object.entries(value.inputs).filter(([, info]) => info.bytesInOutput > 0).map(([path]) => path)))
  const inputFiles = []
  for (const path of [...active].sort()) {
    const absolute = resolve(here, path)
    if (!within(absolute, root)) throw new Error(`Build reads outside the fusion repository: ${path}`)
    const digest = await sha256(absolute)
    let origin
    if (within(absolute, source)) {
      const upstreamPath = normalize(relative(source, absolute)), baseline = original.get(upstreamPath), active = current.get(upstreamPath)
      if (!active || active.type !== 'file') throw new Error(`Build input missing from reviewed fork: ${upstreamPath}`)
      same(digest, active.sha256, `Framework source bytes ${upstreamPath}`)
      origin = { kind: baseline?.sha256 === digest ? 'upstream-source' : 'fork-source', path: upstreamPath }
    } else if (within(absolute, join(here, 'node_modules'))) origin = { kind: 'published-dependency', path: normalize(relative(here, absolute)) }
    else if (['src/desktop-product.ts', 'prepare-profile.mjs', 'check-profile.mjs'].some(path => absolute === join(here, path))) origin = { kind: 'product-composition', path: normalize(relative(root, absolute)) }
    else throw new Error(`Unexpected non-upstream source input in ${name}: ${path}`)
    inputFiles.push({ ...origin, sha256: digest })
  }
  const externalImports = [...new Set(outputs.flatMap(([, value]) => value.imports.filter(item => item.external).map(item => item.path)))].sort()
  const externalDependencies = []
  for (const specifier of externalImports) {
    if (isBuiltin(specifier) || specifier === 'electron') continue
    const resolved = await realpath(require.resolve(specifier))
    if (!within(resolved, compiled)) throw new Error(`External package escaped the source workspace: ${specifier} -> ${resolved}`)
    if (specifier.startsWith('@deepseek-ai/')) {
      const name = specifier.split('/').slice(0, 2).join('/')
      const pkg = framework.packages.find(entry => entry.name === name)
      if (!pkg || !within(resolved, join(compiled, pkg.path))) throw new Error(`Official external package is not source-built: ${specifier} -> ${resolved}`)
    }
    externalDependencies.push({ specifier, path: normalize(relative(compiled, resolved)), sha256: await sha256(resolved) })
  }
  report.records[name] = { sourceEntry: name === 'product' ? normalize(relative(root, entry)) : entry, productInputCount: inputFiles.filter(item => item.kind === 'product-composition').length, sourceInputCount: inputFiles.filter(item => item.kind === 'upstream-source').length,
    forkInputCount: inputFiles.filter(item => item.kind === 'fork-source').length,
    publishedInputCount: inputFiles.filter(item => item.kind === 'published-dependency').length,
    unusedInputCount: Object.keys(record.inputs).length - active.size, inputs: inputFiles, externalDependencies,
    outputs: await Promise.all(outputs.map(async ([path, value]) => {
      const absolute = resolve(here, path)
      if (!within(absolute, output)) throw new Error(`Build output escaped dist/desktop: ${path}`)
      same((await stat(absolute)).size, value.bytes, `Build output size ${path}`)
      return { path: normalize(relative(output, absolute)), sha256: await sha256(absolute) }
    })) }
}
for (const [prefix, target] of [['apps/desktop/renderer/', 'renderer/'], ['apps/desktop/resources/', 'resources/'], ['apps/desktop/scripts/node-bin/', 'scripts/node-bin/']]) {
  for (const entry of framework.entries.filter(value => value.path.startsWith(prefix) && value.type === 'file')) {
    const path = target + entry.path.slice(prefix.length)
    same(await sha256(join(output, path)), entry.sha256, `Copied official asset ${path}`)
    report.copiedAssets.push({ path, upstreamPath: entry.path, sha256: entry.sha256 })
  }
}
// Private native window/menu helpers are copied verbatim because upstream does not export them.
const upstreamMain = await readFile(join(source, 'apps/desktop/src/main.ts'), 'utf8')
const productMain = await readFile(join(here, 'src/desktop-product.ts'), 'utf8')
const copiedBlocks = [
  ['chromeFallbackFill', 'function chromeFallbackFill()', '/**\n * Add the effective Desktop palette'],
  ['createWindow', 'function createWindow(', 'async function main():'],
  ['windowsMenuAndAppearance', "  if (process.platform === 'win32') {\n    ipcMain.handle(DESKTOP_IPC.windowsMenu", '  const hideMainWindow ='],
]
report.copiedNativeBlocks = copiedBlocks.map(([name, start, end]) => {
  const block = upstreamMain.slice(upstreamMain.indexOf(start), upstreamMain.indexOf(end))
  if (!block || !productMain.includes(block)) throw new Error(`Copied official native block changed: ${name}`)
  return { name, source: 'apps/desktop/src/main.ts', product: 'apps/harness/src/desktop-product.ts', bytes: Buffer.byteLength(block) }
})
same(await sha256(join(here, 'src/desktop-main.mjs')), await sha256(join(output, 'main.mjs')), 'YouDub product entry')
report.productEntry = { source: 'apps/harness/src/desktop-main.mjs', output: 'main.mjs', sha256: await sha256(join(output, 'main.mjs')) }
report.buildMetadataSha256 = await sha256(join(output, 'build-inputs.json'))
await assertStagedSource(compiled, framework)
const frameworkReceipt = JSON.parse(await readFile(join(compiled, 'youdub-source-build.json'), 'utf8'))
same(frameworkReceipt.sourceTreeSha256, framework.sha256, 'Framework build source hash')
const inputs = JSON.parse(await readFile(join(output, 'source-build-inputs.json'), 'utf8'))
same(inputs.source, compiled, 'Official build workspace')
same(inputs.officialBuild, 'scripts/build.ts --scope artifacts', 'Official build command')
const expectedPreloads = ['apps/desktop/lib/preload-app.cjs']
same(JSON.stringify(inputs.preloads), JSON.stringify(expectedPreloads), 'Official preload input set')
const officialArtifacts = []
for (const path of expectedPreloads) {
  const destination = join(output, 'lib', path.split('/').at(-1))
  const digest = await sha256(join(compiled, path))
  same(await sha256(destination), digest, `Copied source-built preload ${path}`)
  officialArtifacts.push({ path, sha256: digest, usage: 'copied-verbatim' })
}
for (const [field, path] of [['host', 'apps/desktop-host/lib/index.js'], ['cli', 'apps/cli/lib/bin.js']]) {
  same(inputs[field], path, `Source-built ${field} entry`)
  officialArtifacts.push({ path, sha256: await sha256(join(compiled, path)), usage: 'source-development-link' })
}
const clientBuild = JSON.parse(await readFile(join(compiled, '.dsh-build/client-build-environment.json'), 'utf8'))
const { readClientBuildRecord } = await import(pathToFileURL(join(compiled, 'scripts/client-build-environment.ts')))
readClientBuildRecord(compiled, clientBuild.environment)
same(clientBuild.environment.DSH_CLIENT_TITLE, 'YouDub', 'Official client product title')
same(clientBuild.environment.DSH_CLIENT_VERSION, JSON.parse(await readFile(join(compiled, 'package.json'), 'utf8')).version, 'Official client framework version')
const runtime = join(output, 'runtime-project')
const sourceRuntime = JSON.parse(await readFile(join(runtime, 'youdub-source-runtime.json'), 'utf8'))
for (const pkg of sourceRuntime.sourcePackages) {
  const baseline = framework.packages.find(entry => entry.name === pkg.name)
  if (!baseline) throw new Error(`Unrecognized source-runtime package ${pkg.name}`)
  same(pkg.source, baseline.path, `Source-runtime package origin ${pkg.name}`)
  same(await realpath(join(runtime, 'node_modules', pkg.name)), await realpath(join(compiled, pkg.source)), `Runtime source link ${pkg.name}`)
}
for (const [name, path] of [['@deepseek-ai/dsh', 'apps/cli'], ['@deepseek-ai/dsh-desktop-host', 'apps/desktop-host'], ['@deepseek-ai/dsh-web-frontend', 'apps/web']]) {
  same(await realpath(join(runtime, 'node_modules', name)), await realpath(join(compiled, path)), `Required runtime source ${name}`)
}
report.frameworkBuild = { sourceFiles: framework.entries.length, product: frameworkReceipt.product, officialBuild: inputs.officialBuild,
  clientBuild, artifacts: officialArtifacts, runtimePackages: sourceRuntime.sourcePackages }
const text = JSON.stringify(report, null, 2) + '\n'
if (process.argv.includes('--record')) await writeFile(receiptPath, text)
else same(await readFile(receiptPath, 'utf8'), text, 'Build provenance receipt; rebuild and record after authorized source/build changes')
console.log(JSON.stringify({ passed: true, recorded: process.argv.includes('--record'), receipt: receiptPath, upstreamCommit: manifest.commit,
  builds: Object.fromEntries(Object.entries(report.records).map(([name, value]) => [name, { sourceInputs: value.sourceInputCount, forkInputs: value.forkInputCount, productInputs: value.productInputCount, publishedInputs: value.publishedInputCount, externalPackages: value.externalDependencies.length }])),
  frameworkBuild: { sourceFiles: report.frameworkBuild.sourceFiles, clientFiles: clientBuild.artifacts.fileCount, runtimePackages: sourceRuntime.sourcePackages.length, copiedPreloads: expectedPreloads.length },
  copiedAssets: report.copiedAssets.length, limitations: report.limitations }, null, 2))
