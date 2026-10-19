import { test } from 'node:test'
import assert from 'node:assert/strict'
import { availableUpdate, checkForUpdates, releasesURL } from '../src/updates.js'

function release(version: string, platforms = ['macos-arm64', 'windows-x64']) {
  const base = 'https://github.com/liuzhao1225/YouDub-webui/releases'
  return { version: `v${version}`, url: `${base}/tag/v${version}`, platforms: platforms.map(id => {
    const url = `${base}/download/v${version}/YouDub-${version}-${id === 'macos-arm64' ? 'macOS-arm64.dmg' : 'windows-x64.zip'}`
    return { id, url, checksum: url + '.sha256' }
  }) }
}
test('compares numeric versions, chooses the current platform and never offers a downgrade', () => {
  const feed = [release('0.9.0'), release('0.11.0', ['macos-arm64']), release('0.10.0')]
  assert.equal(availableUpdate(feed, '0.9.0', 'windows-x64')?.version, '0.10.0')
  assert.equal(availableUpdate(feed, '0.9.0', 'macos-arm64')?.version, '0.11.0')
  assert.equal(availableUpdate(feed, '0.11.0', 'macos-arm64'), null)
  assert.equal(availableUpdate(feed, '1.0.0', 'windows-x64'), null)
})
test('rejects malformed release lists and non-repository downloads or missing checksums', () => {
  for (const value of [null, [], [release('1.0.0-beta')], [{ ...release('1.0.0'), url: 'https://other.example' }]]) {
    assert.throws(() => availableUpdate(value, '0.0.3', 'macos-arm64'))
  }
  for (const field of ['url', 'checksum'] as const) {
    const item = release('1.0.0')
    item.platforms[0][field] = 'https://other.example/update.dmg'
    assert.throws(() => availableUpdate([item], '0.0.3', 'macos-arm64'), /asset or checksum URL/)
  }
})
test('fetches the fixed public list without credentials and reports HTTP and parsing failures', async () => {
  let calls = 0
  const request: typeof fetch = async (input, options) => {
    calls++
    assert.equal(input, releasesURL)
    assert.deepEqual(options?.headers, { Accept: 'application/json' })
    assert.equal(options?.redirect, 'error')
    assert.ok(options?.signal)
    return Response.json([release('0.0.4')])
  }
  const result = await checkForUpdates('0.0.3', 'windows-x64', request)
  assert.equal(result.available?.version, '0.0.4')
  assert.ok(Date.parse(result.checkedAt))
  assert.equal(calls, 1)
  await assert.rejects(checkForUpdates('0.0.3', 'windows-x64', async () => new Response('', { status: 503 })), /HTTP 503/)
  await assert.rejects(checkForUpdates('0.0.3', 'windows-x64', async () => Response.json([])), /empty or invalid/)
  await assert.rejects(checkForUpdates('0.0.3', null, request), /No desktop release/)
  assert.equal(calls, 1)
})
