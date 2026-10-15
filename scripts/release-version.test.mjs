import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateReleaseVersion } from './release-version.mjs'

test('accepts the matching release tag and local build version', () => {
  assert.equal(validateReleaseVersion('0.0.1', 'v0.0.1'), '0.0.1')
  assert.equal(validateReleaseVersion('1.2.3'), '1.2.3')
})
test('rejects a tag that would publish a different application version', () => {
  for (const tag of ['v0.0.2', '0.0.1', 'v0.0.1/test', 'v0.0.1-rc.1']) {
    assert.throws(() => validateReleaseVersion('0.0.1', tag))
  }
})
test('rejects malformed versions before packaging', () => {
  for (const version of [undefined, 'v0.0.1', '01.0.1', '../main', '1.0', '1.0.0\n']) {
    assert.throws(() => validateReleaseVersion(version))
  }
})
