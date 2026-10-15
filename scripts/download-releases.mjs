import { readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const repository = 'https://github.com/liuzhao1225/YouDub-webui'
export function downloadReleases(releases) {
  return releases.flat().filter(item => !item.draft && !item.prerelease && /^v\d+\.\d+\.\d+$/.test(item.tag_name)).map(item => {
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
      return [{ ...platform, url: asset.browser_download_url, checksum: checksum.browser_download_url }]
    })
    return { version: item.tag_name, url: `${repository}/releases/tag/${item.tag_name}`, platforms }
  }).filter(item => item.platforms.length).sort((a, b) => b.version.slice(1).localeCompare(a.version.slice(1), 'en', { numeric: true }))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const releases = downloadReleases(JSON.parse(await readFile(process.argv[2], 'utf8')))
  if (!releases.length) throw new Error('No published desktop release with checksums.')
  await writeFile(new URL('../site/releases.json', import.meta.url), JSON.stringify(releases, null, 2) + '\n')
}
