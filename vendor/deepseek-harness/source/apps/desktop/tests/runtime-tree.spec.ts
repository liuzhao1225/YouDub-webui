import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { DESKTOP_RUNTIME_FILE, readDesktopRuntime } from '../src/runtime-tree.ts'
import { runtimeFixture } from './runtime-fixture.ts'

const roots: string[] = []
function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'desktop-runtime-'))
  roots.push(root)
  runtimeFixture(join(root, 'dsh'))
  return root
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

it('reads file inventory records unchanged during startup', () => {
  const dsh = join(fixture(), 'dsh')
  const path = join(dsh, DESKTOP_RUNTIME_FILE)
  const descriptor = JSON.parse(readFileSync(path, 'utf8')) as { files: unknown[] }
  descriptor.files.unshift({ path: '../outside', bytes: -1.5, sha256: 'unchecked', executable: 'unchecked' })
  writeFileSync(path, JSON.stringify(descriptor))
  expect(readDesktopRuntime(dsh).files).toEqual(descriptor.files)
})
it('rejects a descriptor that maps a shared package outside node_modules', () => {
  const dsh = join(fixture(), 'dsh')
  const path = join(dsh, DESKTOP_RUNTIME_FILE)
  const descriptor = JSON.parse(readFileSync(path, 'utf8')) as { sharedPackages: { path: string }[] }
  descriptor.sharedPackages[0]!.path = '../outside'
  writeFileSync(path, JSON.stringify(descriptor))
  expect(() => readDesktopRuntime(dsh)).toThrow(/shared package record/u)
})
