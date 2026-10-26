import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { writeProfileBundles } from '../src/profile-plugins.ts'

it('writes the bundle list while preserving custom profile and dependency metadata', () => {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-profile-bundles-'))
  try {
    const manifest = { private: false, custom: { keep: true }, dependencies: { plugin: '^1' },
      dsh: { profile: { bundles: ['old'] } } }
    const updated = writeProfileBundles(directory, manifest, ['template', 'plugin'])
    expect(updated).toEqual({ ...manifest, dsh: { profile: { bundles: ['template', 'plugin'] } } })
    expect(JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))).toEqual(updated)
    expect(manifest.dsh.profile.bundles).toEqual(['old'])
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
