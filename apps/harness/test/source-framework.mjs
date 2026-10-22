// All first-party imports in product tests use the reviewed source build, including
// imports made by unbundled business modules. Missing outputs fail without npm fallback.
import { registerHooks } from 'node:module'
import { readFileSync, realpathSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { join, sep } from 'node:path'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const stage = join(root, '.cache/harness/source-build')
// npm pretest verifies the fork and staged bytes once before test workers start.
const framework = JSON.parse(readFileSync(join(stage, 'youdub-source-inputs.json'), 'utf8'))
const receipt = JSON.parse(readFileSync(join(stage, 'youdub-source-build.json'), 'utf8'))
if (receipt.sourceTreeSha256 !== framework.sha256) throw new Error('Tests require the current framework source build; run npm run build:framework.')
const packages = new Map(framework.packages.map(pkg => [pkg.name, join(stage, pkg.path)]))
const app = new URL('../', import.meta.url).href

registerHooks({
  resolve(specifier, context, nextResolve) {
    const importer = context.parentURL ?? ''
    // Leave runtime projects and source packages to their own resolution rules;
    // tests deliberately remove dependencies to check missing-package failures.
    if (!specifier.startsWith('@deepseek-ai/') || !['src/', 'test/', 'dist/host.mjs'].some(path => importer.startsWith(app + path))) return nextResolve(specifier, context)
    const name = specifier.split('/').slice(0, 2).join('/')
    const directory = packages.get(name)
    if (!directory) throw new Error(`Test import has no reviewed framework source: ${specifier}`)
    const resolved = nextResolve(specifier, { ...context, parentURL: pathToFileURL(join(directory, 'package.json')).href })
    const path = realpathSync(fileURLToPath(resolved.url))
    if (!path.startsWith(realpathSync(directory) + sep)) throw new Error(`Test import escaped its source package: ${specifier}`)
    return resolved
  },
})
