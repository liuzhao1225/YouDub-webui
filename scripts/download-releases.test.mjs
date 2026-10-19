import test from 'node:test'
import assert from 'node:assert/strict'
import { downloadReleases } from './download-releases.mjs'
const release = (tag, files) => ({ tag_name: tag, assets: files.map(name => ({ name, state: 'uploaded', size: 1, browser_download_url: `https://github.com/liuzhao1225/YouDub-webui/releases/download/${tag}/${name}` })) })
test('only published assets with checksums become downloads; older versions keep their platforms', () => {
  const old = release('v0.0.2', ['YouDub-0.0.2-macOS-arm64.dmg', 'YouDub-0.0.2-macOS-arm64.dmg.sha256'])
  const current = release('v0.0.3', ['YouDub-0.0.3-windows-x64.zip', 'YouDub-0.0.3-windows-x64.zip.sha256', 'YouDub-0.0.3-macOS-arm64.dmg'])
  const result = downloadReleases([[old, current, { ...current, draft: true }, { ...current, prerelease: true }]])
  assert.deepEqual(result.map(item => [item.version, item.platforms.map(p => p.id)]), [['v0.0.3', ['windows-x64']], ['v0.0.2', ['macos-arm64']]])
  assert.deepEqual(downloadReleases([release('v0.0.4', [])]), [])
})

test('adds a verified EXE installer while preserving ZIP URLs for older app updaters', () => {
  const zip = 'YouDub-0.0.5-windows-x64.zip', exe = 'YouDub-0.0.5-windows-x64-Setup.exe'
  const item = release('v0.0.5', [zip, zip + '.sha256', exe, exe + '.sha256'])
  const platform = downloadReleases([item])[0].platforms[0]
  assert.ok(platform.url.endsWith('/' + zip))
  assert.ok(platform.installer.url.endsWith('/' + exe))
  assert.equal(platform.installer.checksum, platform.installer.url + '.sha256')
  const missingDigest = release('v0.0.5', [zip, zip + '.sha256', exe])
  assert.equal(downloadReleases([missingDigest])[0].platforms[0].installer, undefined)
})

test('latest links require uploaded fixed-name assets and leave historical downloads intact', () => {
  const files = ['windows-x64.zip', 'windows-x64-Setup.exe', 'macOS-arm64.dmg']
  const assets = version => files.flatMap(file => [`YouDub-${version}-${file}`, `YouDub-${file}`]).flatMap(file => [file, file + '.sha256'])
  const current = release('v0.0.6', assets('0.0.6'))
  const previous = release('v0.0.5', assets('0.0.5'))
  const [latest, old] = downloadReleases([previous, current])
  const windows = latest.platforms.find(item => item.id === 'windows-x64')
  assert.equal(windows.latest.installer.url, 'https://github.com/liuzhao1225/YouDub-webui/releases/latest/download/YouDub-windows-x64-Setup.exe')
  assert.equal(windows.latest.checksum, windows.latest.url + '.sha256')
  assert.ok(windows.url.includes('/v0.0.6/YouDub-0.0.6-'))
  assert.ok(latest.platforms[0].latest.url.endsWith('/YouDub-macOS-arm64.dmg'))
  assert.ok(old.platforms.every(item => item.latest === undefined))
  current.assets = current.assets.filter(item => item.name !== 'YouDub-windows-x64-Setup.exe.sha256')
  assert.equal(downloadReleases([current])[0].platforms[1].latest.installer, undefined)
  current.assets.find(item => item.name === 'YouDub-windows-x64.zip').browser_download_url = 'https://example.com/package.zip'
  assert.throws(() => downloadReleases([current]), /Unexpected latest asset URL/)
})
