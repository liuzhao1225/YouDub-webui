/** Build the reviewed Harness fork for YouDub development, without packaging. */
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { assertStagedSource, productRevision, readFrameworkSource, stageFrameworkSource } from './framework-source.mjs'

const here = fileURLToPath(new URL('.', import.meta.url))
const root = resolve(here, '../..')
const { values } = parseArgs({ options: {
  'verify-only': { type: 'boolean', default: false }, stage: { type: 'string' },
} })
const stage = resolve(values.stage ?? join(root, '.cache/harness/source-build'))
const source = await readFrameworkSource(root)
const pnpm = join(here, 'node_modules/pnpm/bin/pnpm.mjs')
const revision = productRevision(root)
const env = { ...process.env, DSH_CLIENT_TITLE: 'YouDub', DSH_CLIENT_COMMIT_HASH: revision.commit,
  NPM_CONFIG_REGISTRY: 'https://registry.npmmirror.com' }
const run = (args, cwd = stage, extraEnv = {}) => execFileSync(process.execPath, args, { cwd, env: { ...env, ...extraEnv }, stdio: 'inherit' })
const receiptPath = join(stage, 'youdub-source-build.json')
const inputsPath = join(stage, 'youdub-source-inputs.json')
if (!values['verify-only']) {
  await mkdir(stage, { recursive: true })
  let previousEntries = []
  try { previousEntries = JSON.parse(await readFile(inputsPath, 'utf8')).entries }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  await stageFrameworkSource(source, stage, previousEntries)
  await writeFile(inputsPath, JSON.stringify({ sha256: source.sha256, entries: source.entries, packages: source.packages }, null, 2) + '\n')
  run([pnpm, 'install', '--frozen-lockfile', '--registry=https://registry.npmmirror.com'], stage, { CI: 'true' })
  run([join(stage, 'node_modules/tsx/dist/cli.mjs'), 'scripts/build.ts', '--scope', 'artifacts'])
}
await assertStagedSource(stage, source)
const buildRecord = JSON.parse(await readFile(join(stage, '.dsh-build/client-build-environment.json'), 'utf8'))
const { readClientBuildRecord } = await import(pathToFileURL(join(stage, 'scripts/client-build-environment.ts')))
readClientBuildRecord(stage, buildRecord.environment)
if (values['verify-only']) {
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8'))
  if (receipt.sourceTreeSha256 !== source.sha256 || JSON.stringify(receipt.buildRecord) !== JSON.stringify(buildRecord)) {
    throw new Error('Framework build receipt is stale; rebuild the current source before running YouDub')
  }
} else {
  await writeFile(receiptPath, JSON.stringify({ formatVersion: 3, upstream: source.upstream, sourceTreeSha256: source.sha256,
    product: revision, buildRecord,
    buildCommand: 'scripts/build.ts --scope artifacts', development: true,
  }, null, 2) + '\n')
}
console.log(`Source-built YouDub framework workspace: ${stage}`)
