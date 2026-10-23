import { describe, expect, it } from 'vitest'
import { packedWorkspaceClosure, type WorkspacePackage } from './packed-workspace-closure.ts'

function pkg(name: string, manifest: Record<string, unknown> = {}): WorkspacePackage {
  return { name, directory: `/workspace/${name}`, manifest }
}

describe('packed workspace closure', () => {
  it('follows install edges and required peers but excludes development and optional peers', () => {
    const packages = new Map([
      ['root', pkg('root', {
        dependencies: { installed: 'workspace:^' },
        optionalDependencies: { optional: 'workspace:^' },
        peerDependencies: { required: 'workspace:^', omitted: 'workspace:^' },
        peerDependenciesMeta: { omitted: { optional: true } },
        devDependencies: { development: 'workspace:^' },
      })],
      ['installed', pkg('installed', { dependencies: { transitive: 'workspace:^', external: '^1.0.0' } })],
      ['optional', pkg('optional')],
      ['required', pkg('required')],
      ['omitted', pkg('omitted')],
      ['development', pkg('development')],
      ['transitive', pkg('transitive')],
    ])

    expect(packedWorkspaceClosure('root', packages).map(entry => entry.name))
      .toEqual(['installed', 'optional', 'required', 'root', 'transitive'])
  })

  it('fails when a workspace dependency is absent from the inventory', () => {
    const packages = new Map([
      ['root', pkg('root', { dependencies: { missing: 'workspace:^' } })],
    ])
    expect(() => packedWorkspaceClosure('root', packages))
      .toThrow('packed workspace closure cannot resolve missing')
  })
})
