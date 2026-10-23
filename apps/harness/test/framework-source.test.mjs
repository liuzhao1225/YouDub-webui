import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assertStagedSource, stageFrameworkSource } from '../framework-source.mjs'
import { tree } from '../source-tree.mjs'
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'youdub-source-'))
  t.after(() => rm(root, {recursive:true,force:true}))
  const source=join(root,'source');await mkdir(source)
  await writeFile(join(source,'keep.js'),'export const value = 1\n')
  await writeFile(join(source,'remove.js'),'export const unused = true\n')
  return {root,source,original:await tree(source)}
}
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

test('retiring a source file also removes its package compiled outputs', async t => {
  const { root, source } = await fixture(t)
  const packageRoot = join(source, 'packages/client/example')
  await mkdir(join(packageRoot, 'src'), { recursive: true })
  await writeFile(join(packageRoot, 'package.json'), '{"name":"example"}')
  await writeFile(join(packageRoot, 'src/retired.ts'), 'export const unused = true')
  const previous = await tree(source)
  await rm(join(packageRoot, 'src/retired.ts'))
  const stage = join(root, 'stage')
  const output = join(stage, 'packages/client/example/lib')
  await mkdir(output, { recursive: true })
  await writeFile(join(output, 'retired.js'), 'export const unused = true')
  await stageFrameworkSource({ source, ...await tree(source) }, stage, previous.entries)
  await assert.rejects(readFile(join(output, 'retired.js')), { code: 'ENOENT' })
  assert.equal(await readFile(join(stage, 'packages/client/example/package.json'), 'utf8'), '{"name":"example"}')
})
