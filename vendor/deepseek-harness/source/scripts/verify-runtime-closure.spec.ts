import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { verifyRuntimeClosure } from './verify-runtime-closure.ts'

const roots: string[] = []

function fixture(files: Record<string, string | Record<string, unknown>>): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-runtime-closure-'))
  roots.push(root)
  for (const [relative, value] of Object.entries(files)) {
    const path = join(root, relative)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value))
  }
  return root
}

function workspace(root: string, name: string, manifest: Record<string, unknown>): void {
  const packageName = name.replace('@scope/', '')
  const path = join(root, 'packages/core', packageName, 'package.json')
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify({ name, ...manifest }, null, 2)}\n`)
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('verifyRuntimeClosure', () => {
  it('checks a private worker closure without requiring application presets', async () => {
    const manifestPath = 'packages/workers/private-runtime/package.json'
    const root = fixture({ [manifestPath]: { name: 'helper', dependencies: { '@scope/worker': 'workspace:^' } } })
    workspace(root, '@scope/worker', { peerDependencies: { '@scope/peer': 'workspace:^' } })
    workspace(root, '@scope/peer', {})
    expect((await verifyRuntimeClosure(root, manifestPath)).failures).toEqual(['helper -> @scope/worker -> @scope/peer'])
    writeFileSync(join(root, manifestPath), JSON.stringify({ name: 'helper', dependencies: { '@scope/worker': 'workspace:^', '@scope/peer': 'workspace:^' } }))
    expect(await verifyRuntimeClosure(root, manifestPath)).toMatchObject({ failures: [] })
  })

  it('checks an application runtime with pinned dependencies', async () => {
    const manifestPath = 'application/package.json'
    const root = fixture({ [manifestPath]: { name: 'application', dependencies: { '@scope/worker': '1.0.0', '@scope/peer': '1.0.0' } } })
    workspace(root, '@scope/worker', { peerDependencies: { '@scope/peer': 'workspace:^' } })
    workspace(root, '@scope/peer', {})
    expect(await verifyRuntimeClosure(root, manifestPath)).toMatchObject({ failures: [] })
    writeFileSync(join(root, manifestPath), JSON.stringify({ name: 'application', dependencies: { '@scope/worker': '1.0.0' } }))
    expect((await verifyRuntimeClosure(root, manifestPath)).failures).toEqual(['application -> @scope/worker -> @scope/peer'])
  })

  it('retains the required workspace-peer closure check', async () => {
    const root = fixture({
      'application/package.json': { name: 'runtime', dependencies: { '@scope/root': 'workspace:^' } },
    })
    workspace(root, '@scope/root', {
      peerDependencies: { '@scope/required': 'workspace:^', '@scope/optional': 'workspace:^' },
      peerDependenciesMeta: { '@scope/optional': { optional: true } },
    })
    workspace(root, '@scope/required', {})
    workspace(root, '@scope/optional', {})

    const result = await verifyRuntimeClosure(root, 'application/package.json')

    expect(result.workspacePackageCount).toBe(1)
    expect(result.failures).toEqual(['runtime -> @scope/root -> @scope/required'])
  })
})
