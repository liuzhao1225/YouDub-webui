import { describe, expect, it } from 'vitest'
import {
  parsePreviewFixtureManifest, PREVIEW_FIXTURE_MANIFEST_VERSION,
} from '../src/fixture-manifest.ts'

describe('Preview fixture manifest', () => {
  it('accepts a unique named fixture with ordered overlays', () => {
    expect(parsePreviewFixtureManifest({
      version: PREVIEW_FIXTURE_MANIFEST_VERSION,
      defaultFixture: 'example',
      fixtures: [{
        id: 'example',
        label: 'Example',
        description: 'A deterministic example.',
        overlays: ['fixtures/base.tar.gz', 'fixtures/tail.tar.gz'],
      }],
    })).toEqual({
      version: PREVIEW_FIXTURE_MANIFEST_VERSION,
      defaultFixture: 'example',
      fixtures: [{
        id: 'example',
        label: 'Example',
        description: 'A deterministic example.',
        overlays: ['fixtures/base.tar.gz', 'fixtures/tail.tar.gz'],
      }],
    })
  })

  it.each([
    [{ version: 2, defaultFixture: null, fixtures: [] }, /must use version/],
    [{ version: 1, defaultFixture: 'missing', fixtures: [] }, /defaultFixture/],
    [{
      version: 1,
      defaultFixture: 'duplicate',
      fixtures: [
        { id: 'duplicate', label: 'One', description: 'First.', overlays: ['one.tar.gz'] },
        { id: 'duplicate', label: 'Two', description: 'Second.', overlays: ['two.tar.gz'] },
      ],
    }, /repeats id/],
    [{
      version: 1,
      defaultFixture: 'none',
      fixtures: [{ id: 'none', label: 'None', description: 'Reserved.', overlays: ['none.tar.gz'] }],
    }, /invalid fixture entry/],
  ])('rejects malformed catalogs', (value, error) => {
    expect(() => parsePreviewFixtureManifest(value)).toThrow(error)
  })
})
