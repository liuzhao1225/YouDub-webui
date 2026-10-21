import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { checkSourceRuntime } from '../check-source-runtime.mjs'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'youdub-source-runtime-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const appRoot = join(root, 'YouDub.app'), sourceBuild = join(root, 'build')
  const manifest = { packages: [] }
  for (const name of ['@deepseek-ai/dsh', '@deepseek-ai/dsh-desktop-host']) {
    const path = `packages/${name.split('/')[1]}`
    const built = join(sourceBuild, path), installed = join(appRoot, 'Contents/Resources/dsh/node_modules', name)
    manifest.packages.push({ name, path, version: '1.2.3' })
    for (const directory of [built, installed]) {
      await mkdir(join(directory, 'lib'), { recursive: true })
      await writeFile(join(directory, 'package.json'), JSON.stringify({ name, version: '1.2.3' }))
      await writeFile(join(directory, 'lib/index.js'), 'export const upstream = true\n')
    }
  }
  return { root, appRoot, sourceBuild, manifest }
}

test('accepts source-built bytes and relative links inside the App', async t => {
  const setup = await fixture(t)
  const app = join(setup.appRoot, 'Contents/Resources/app')
  await mkdir(app)
  await symlink('../dsh/node_modules', join(app, 'node_modules'))
  const result = await checkSourceRuntime(setup)
  assert.equal(result.passed, true, result.findings.join('\n'))
  assert.equal(result.packages.length, 2)
})

test('rejects external symlinks and absolute build paths in launch code', async t => {
  const setup = await fixture(t)
  await symlink(setup.sourceBuild, join(setup.appRoot, 'development-source'))
  await writeFile(join(setup.appRoot, 'main.mjs'), 'import "/Users/test/.codex/worktrees/task/project/main.mjs"\n')
  const result = await checkSourceRuntime(setup)
  assert.equal(result.passed, false)
  assert.ok(result.findings.some(value => value.startsWith('Symlink leaves App:')))
  assert.ok(result.findings.some(value => value.startsWith('Codex worktree path')))
})

test('rejects a published or changed payload even if package version matches', async t => {
  const setup = await fixture(t)
  await writeFile(join(setup.appRoot, 'Contents/Resources/dsh/node_modules/@deepseek-ai/dsh/lib/index.js'), 'export const registry = true\n')
  const result = await checkSourceRuntime(setup)
  assert.equal(result.passed, false)
  assert.ok(result.findings.includes('Not the source-build output: @deepseek-ai/dsh/lib/index.js'))
})

test('rejects unknown first-party packages and mismatched upstream versions', async t => {
  const setup = await fixture(t)
  const directory = join(setup.appRoot, 'Contents/Resources/dsh/node_modules/@deepseek-ai/unknown')
  await mkdir(directory)
  await writeFile(join(directory, 'package.json'), JSON.stringify({ name: '@deepseek-ai/unknown', version: '0.0.1' }))
  setup.manifest.packages[0].version = '2.0.0'
  const result = await checkSourceRuntime(setup)
  assert.equal(result.passed, false)
  assert.ok(result.findings.some(value => value.startsWith('No preserved source or external provenance:')))
  assert.ok(result.findings.some(value => value.startsWith('Source version differs:')))
})
