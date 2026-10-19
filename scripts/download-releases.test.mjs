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
