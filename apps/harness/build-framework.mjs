/** Build the preserved upstream workspace for YouDub development. */
import { execFileSync } from 'node:child_process'
import { copyFile, mkdir, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

const here = fileURLToPath(new URL('.', import.meta.url))
const root = resolve(here, '../..')
const source = join(root, 'vendor/deepseek-harness/source')
const stage = join(root, '.cache/harness/source-build')
const { values } = parseArgs({ options: { 'verify-only': { type: 'boolean', default: false } } })
const manifest = JSON.parse(await readFile(join(root, 'vendor/deepseek-harness/source-manifest.json'), 'utf8'))
const pnpm = join(here, 'node_modules/pnpm/bin/pnpm.mjs')
const env = { ...process.env, LEFTHOOK: '0', DSH_CLIENT_TITLE: 'YouDub', DSH_CLIENT_COMMIT_HASH: manifest.commit,
  NPM_CONFIG_REGISTRY: 'https://registry.npmmirror.com' }
const run = (args, cwd = stage) => execFileSync(process.execPath, args, { cwd, env, stdio: 'inherit' })
run([join(here, 'baselines/vendor.mjs'), '--verify'], root)
if (!values['verify-only']) {
  await mkdir(stage, { recursive: true })
  for (const entry of manifest.entries) {
    const destination = join(stage, entry.path)
    await mkdir(dirname(destination), { recursive: true })
    if (entry.type === 'symlink') {
      let current
      try { current = await readlink(destination) } catch (error) { if (error.code !== 'ENOENT') throw error }
      const target = await readlink(join(source, entry.path))
      if (current !== target) { await rm(destination, { force: true }); await symlink(target, destination) }
    } else await copyFile(join(source, entry.path), destination)
  }
  run([pnpm, 'install', '--frozen-lockfile', '--registry=https://registry.npmmirror.com'])
  run([join(stage, 'node_modules/tsx/dist/cli.mjs'), 'scripts/build.ts', '--scope', 'artifacts'])
}
// Require the official full-build receipt before preparing the development runtime.
const buildRecord = JSON.parse(await readFile(join(stage, '.dsh-build/client-build-environment.json'), 'utf8'))
const { readClientBuildRecord } = await import(pathToFileURL(join(stage, 'scripts/client-build-environment.ts')))
readClientBuildRecord(stage, buildRecord.environment)
await writeFile(join(stage, 'youdub-source-build.json'), JSON.stringify({ upstreamCommit: manifest.commit,
  sourceTreeSha256: manifest.sha256, buildRecord,
  buildCommand: 'scripts/build.ts --scope artifacts', development: true,
}, null, 2) + '\n')
console.log(`Source-built Harness development workspace: ${stage}`)
