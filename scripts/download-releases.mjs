import { readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const repository = 'https://github.com/liuzhao1225/YouDub-webui'
export function downloadReleases(releases, latestTag) {
  if (!/^v\d+\.\d+\.\d+$/.test(latestTag)) throw new Error('GitHub latest release must be a stable version tag.')
  const published = releases.flat().filter(item => !item.draft && !item.prerelease && /^v\d+\.\d+\.\d+$/.test(item.tag_name))
  const downloads = published.map(item => {
    const version = item.tag_name.slice(1)
    const assets = item.assets.filter(asset => asset.state === 'uploaded' && asset.size > 0)
    const platforms = [
      { id: 'macos-arm64', name: 'macOS', requirements: 'macOS 14+ · Apple 芯片', file: `YouDub-${version}-macOS-arm64.dmg` },
      { id: 'windows-x64', name: 'Windows', requirements: 'Windows 10 22H2 / 11 · x64', file: `YouDub-${version}-windows-x64.zip` },
    ].flatMap(platform => {
      const asset = assets.find(asset => asset.name === platform.file)
      const checksum = assets.find(asset => asset.name === platform.file + '.sha256')
      if (!asset || !checksum) return []
      for (const file of [asset, checksum]) {
        if (file.browser_download_url !== `${repository}/releases/download/${item.tag_name}/${file.name}`) throw new Error(`Unexpected asset URL: ${file.name}`)
      }
      const result = { ...platform, url: asset.browser_download_url, checksum: checksum.browser_download_url }
      // Keep the ZIP fields for v0.0.4 clients, which validate their exact filename.
      if (platform.id === 'windows-x64') {
        const name = `YouDub-${version}-windows-x64-Setup.exe`
        const installer = assets.find(asset => asset.name === name)
        const digest = assets.find(asset => asset.name === name + '.sha256')
        if (installer && digest) {
          const url = `${repository}/releases/download/${item.tag_name}/${name}`
          if (installer.browser_download_url !== url || digest.browser_download_url !== url + '.sha256') throw new Error(`Unexpected installer URL: ${name}`)
          result.installer = { url, checksum: digest.browser_download_url }
        }
      }
      return [result]
    })
    return { version: item.tag_name, url: `${repository}/releases/tag/${item.tag_name}`, platforms }
  }).filter(item => item.platforms.length).sort((a, b) => b.version.slice(1).localeCompare(a.version.slice(1), 'en', { numeric: true }))
  const latestIndex = downloads.findIndex(item => item.version === latestTag)
  if (downloads.length && latestIndex < 0) throw new Error(`GitHub latest release has no published desktop assets: ${latestTag}`)
  if (latestIndex > 0) downloads.unshift(...downloads.splice(latestIndex, 1))
  const latest = downloads[0]
  if (latest) {
    // Keep the array and versioned asset fields for already installed clients.
    latest.isLatest = true
    const assets = published.find(item => item.tag_name === latest.version).assets
    const alias = name => {
      const files = [name, name + '.sha256'].map(file => assets.find(asset => asset.name === file && asset.state === 'uploaded' && asset.size > 0))
      if (files.some(file => !file)) return undefined
      for (const file of files) {
        if (file.browser_download_url !== `${repository}/releases/download/${latest.version}/${file.name}`) throw new Error(`Unexpected latest asset URL: ${file.name}`)
      }
      const url = `${repository}/releases/latest/download/${name}`
      return { url, checksum: url + '.sha256' }
    }
    for (const platform of latest.platforms) {
      const file = platform.file.replace(`YouDub-${latest.version.slice(1)}-`, 'YouDub-')
      const stable = alias(file)
      if (stable) {
        platform.latest = stable
        if (platform.installer) stable.installer = alias('YouDub-windows-x64-Setup.exe')
      }
    }
  }
  return downloads
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const latest = JSON.parse(await readFile(process.argv[3], 'utf8'))
  const releases = downloadReleases(JSON.parse(await readFile(process.argv[2], 'utf8')), latest.tag_name)
  if (!releases.length) throw new Error('No published desktop release with checksums.')
  await writeFile(new URL('../site/releases.json', import.meta.url), JSON.stringify(releases, null, 2) + '\n')
}
