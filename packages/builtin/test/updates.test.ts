import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { availableUpdate, checkForUpdates, releasesURL } from '../src/updates.js'

function release(version: string, platforms = ['macos-arm64', 'windows-x64']) {
  const base = 'https://github.com/liuzhao1225/YouDub-webui/releases'
  return { version: `v${version}`, url: `${base}/tag/v${version}`, platforms: platforms.map(id => {
    const url = `${base}/download/v${version}/YouDub-${version}-${id === 'macos-arm64' ? 'macOS-arm64.dmg' : 'windows-x64.zip'}`
    return { id, url, checksum: url + '.sha256' }
  }) }
}
test('follows GitHub Latest even when a higher historical release exists, without downgrades', () => {
  const feed = [release('0.11.0'), { ...release('0.10.0'), isLatest: true }, release('0.9.0')]
  assert.equal(availableUpdate(feed, '0.9.0', 'windows-x64')?.version, '0.10.0')
  assert.equal(availableUpdate(feed, '0.9.0', 'macos-arm64')?.version, '0.10.0')
  assert.equal(availableUpdate(feed, '0.10.0', 'macos-arm64'), null)
  assert.equal(availableUpdate(feed, '0.11.0', 'macos-arm64'), null)
  assert.equal(availableUpdate(feed, '1.0.0', 'windows-x64'), null)
})
test('legacy feeds use their first release and never substitute another platform release', () => {
  const feed = [release('0.10.0', ['macos-arm64']), release('0.11.0')]
  assert.equal(availableUpdate(feed, '0.9.0', 'macos-arm64')?.version, '0.10.0')
  assert.equal(availableUpdate(feed, '0.9.0', 'windows-x64'), null)
  assert.throws(() => availableUpdate(feed.map(item => ({ ...item, isLatest: true })), '0.9.0', 'macos-arm64'), /exactly one latest/)
  assert.throws(() => availableUpdate([{ ...feed[0], isLatest: false }], '0.9.0', 'macos-arm64'), /exactly one latest/)
})
test('prefers a validated Windows EXE installer and still accepts historical ZIP releases', () => {
  const item = release('0.0.5', ['windows-x64'])
  const url = item.platforms[0].url.replace('.zip', '-Setup.exe')
  const platform = { ...item.platforms[0], installer: { url, checksum: url + '.sha256' } }
  assert.equal(availableUpdate([{ ...item, platforms: [platform] }], '0.0.4', 'windows-x64')?.download, url)
  assert.equal(availableUpdate([item], '0.0.4', 'windows-x64')?.download, item.platforms[0].url)
  platform.installer.url = 'https://untrusted.example/Setup.exe'
  assert.throws(() => availableUpdate([{ ...item, platforms: [platform] }], '0.0.4', 'windows-x64'), /asset or checksum URL/)
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

test('a physically copied Windows plugin imports without a node_modules/package.json', async t => {
  const root = await mkdtemp(join(tmpdir(), 'youdub-copied-plugin-'))
  t.after(() => rm(root, { recursive: true }))
  const scope = join(root, 'node_modules', '@youdub')
  const source = join(scope, 'builtin', 'src')
  await mkdir(source, { recursive: true })
  await symlink(resolve('packages/sdk'), join(scope, 'sdk'), process.platform === 'win32' ? 'junction' : 'dir')
  await cp(new URL('../src/updates.ts', import.meta.url), join(source, 'updates.ts'))
  const copied = await import(pathToFileURL(join(source, 'updates.ts')).href)
  assert.equal(copied.availableUpdate([release('0.0.4')], '0.0.3', 'windows-x64')?.version, '0.0.4')
})
