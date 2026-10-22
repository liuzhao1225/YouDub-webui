import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { assertStagedSource, readFrameworkSource, sourceChanges, stageFrameworkSource, verifyChanges } from '../baselines/framework-source.mjs'
import { sha256, tree } from '../baselines/tree.mjs'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'youdub-framework-fork-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const directory = join(root, 'vendor/deepseek-harness'), source = join(directory, 'source')
  await mkdir(source, { recursive: true })
  await writeFile(join(source, 'keep.js'), 'export const value = 1\n')
  await writeFile(join(source, 'remove.js'), 'export const unused = true\n')
  execFileSync('git', ['init', '--quiet', root])
  execFileSync('git', ['-C', root, 'add', '--', 'vendor/deepseek-harness/source'])
  const original = { commit: 'upstream', packages: [], ...await tree(source) }
  const manifestPath = join(directory, 'source-manifest.json')
  await writeFile(manifestPath, JSON.stringify(original))
  const fork = { formatVersion: 1, upstreamCommit: original.commit, originalManifestSha256: await sha256(manifestPath), changes: [] }
  const save = () => writeFile(join(directory, 'fork.json'), JSON.stringify(fork))
  await save()
  return { root, source, directory, original, fork, save }
}

test('keeps the immutable manifest separate from exact reviewed additions, edits and removals', async t => {
  const fixtureData = await fixture(t)
  const { root, source, original, fork, save } = fixtureData
  assert.equal((await readFrameworkSource(root)).sha256, original.sha256)
  await writeFile(join(source, 'keep.js'), 'export const value = 2\n')
  await rm(join(source, 'remove.js'))
  await writeFile(join(source, 'new.js'), 'export const product = "YouDub"\n')
  await assert.rejects(readFrameworkSource(root), /differs from the reviewed fork ledger/)
  fork.changes = sourceChanges(original, await tree(source)).map(entry => ({ ...entry, reason: 'Remove unused product behavior' }))
  await save()
  const result = await readFrameworkSource(root)
  assert.equal(result.fork.changes.length, 3)
  assert.equal(result.original.sha256, original.sha256)
  await writeFile(join(source, 'keep.js'), 'export const value = 3\n')
  await assert.rejects(readFrameworkSource(root), error => {
    assert.match(error.message, /differs from the reviewed fork ledger; 1 mismatched entries/)
    assert.match(error.message, /"path":"keep.js"/)
    assert.match(error.message, /"expected".*"actual"/)
    assert.doesNotMatch(error.message, /export const value/)
    return true
  })
})

test('rejects rewriting the upstream manifest and missing change reasons', async t => {
  const { root, source, directory, original } = await fixture(t)
  await writeFile(join(source, 'new.js'), '// new\n')
  const current = await tree(source)
  assert.throws(() => verifyChanges(original, current, sourceChanges(original, current)), /Missing fork change reason/)
  await writeFile(join(directory, 'source-manifest.json'), JSON.stringify({ ...original, ...current }))
  await assert.rejects(readFrameworkSource(root), /immutable upstream source manifest has changed/)
})

test('staging removes retired inputs, replaces links without following them, and detects stale bytes', async t => {
  const { root, source, original } = await fixture(t)
  const stage = join(root, 'stage'), outside = join(root, 'outside.js')
  await mkdir(stage)
  await writeFile(outside, 'do not overwrite\n')
  await symlink(outside, join(stage, 'keep.js'))
  await writeFile(join(stage, 'remove.js'), 'old compiled input\n')
  await rm(join(source, 'remove.js'))
  const current = { source, ...await tree(source) }
  await stageFrameworkSource(current, stage, original.entries)
  assert.equal(await readFile(outside, 'utf8'), 'do not overwrite\n')
  await assert.rejects(readFile(join(stage, 'remove.js')), { code: 'ENOENT' })
  await assertStagedSource(stage, current)
  await writeFile(join(stage, 'keep.js'), 'stale build input\n')
  await assert.rejects(assertStagedSource(stage, current), /Staged source bytes differ/)
  await assert.rejects(stageFrameworkSource(current, source, []), /separate from framework source/)
})

test('executable mode and link target changes require review', { skip: process.platform === 'win32' }, async t => {
  const { source, original } = await fixture(t)
  await chmod(join(source, 'keep.js'), 0o755)
  await symlink('keep.js', join(source, 'linked.js'))
  const current = await tree(source)
  const changes = sourceChanges(original, current)
  assert.equal(changes.length, 2)
  assert.equal(changes.find(entry => entry.path === 'keep.js').after.executable, true)
  assert.equal(changes.find(entry => entry.path === 'linked.js').after.target, 'keep.js')
  assert.throws(() => verifyChanges(original, current, []), /differs from the reviewed fork ledger/)
})

test('Windows source verification uses Git executable modes and rejects unreviewed mode changes', async t => {
  const { root, source, original, fork, save } = await fixture(t)
  execFileSync('git', ['-C', source, 'update-index', '--chmod=+x', 'keep.js'])
  const expected = await tree(source, { executableModes: new Map([['keep.js', true]]) })
  fork.changes = sourceChanges(original, expected).map(entry => ({ ...entry, reason: 'Review executable mode recorded in Git' }))
  await save()
  assert.equal((await readFrameworkSource(root, { platform: 'win32' })).sha256, expected.sha256)
  execFileSync('git', ['-C', source, 'update-index', '--chmod=-x', 'keep.js'])
  await assert.rejects(readFrameworkSource(root, { platform: 'win32' }), /differs from the reviewed fork ledger/)
})

test('retiring a package rejects and removes its compiled outputs while retaining live package outputs', async t => {
  const { root, source } = await fixture(t)
  const stage = join(root, 'stage'), retired = 'packages/client/retired', retained = 'packages/client/retained'
  for (const path of [retired, retained]) {
    await mkdir(join(source, path), { recursive: true })
    await writeFile(join(source, path, 'package.json'), '{}\n')
    await mkdir(join(stage, path, 'lib'), { recursive: true })
    await writeFile(join(stage, path, 'lib/client.js'), 'compiled output\n')
  }
  const original = { packages: [{ path: retired }, { path: retained }], ...await tree(source) }
  await rm(join(source, retired), { recursive: true })
  const current = { source, original, ...await tree(source) }
  await assert.rejects(assertStagedSource(stage, current), /Retired framework package remains/)
  await stageFrameworkSource(current, stage, original.entries)
  await assert.rejects(readFile(join(stage, retired, 'lib/client.js')), { code: 'ENOENT' })
  assert.equal(await readFile(join(stage, retained, 'lib/client.js'), 'utf8'), 'compiled output\n')
  await assertStagedSource(stage, current)
})
