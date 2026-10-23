import { AppError } from '@youdub/sdk'

export const releasesURL = 'https://liuzhao1225.github.io/YouDub-webui/releases.json'
const repository = 'https://github.com/liuzhao1225/YouDub-webui'
export const updatePlatform = process.platform === 'darwin' && process.arch === 'arm64' ? 'macos-arm64'
  : process.platform === 'win32' && process.arch === 'x64' ? 'windows-x64' : null
type Platform = 'macos-arm64' | 'windows-x64'
export type AvailableUpdate = { version: string; url: string; download: string; checksum: string }

function versionParts(version: string) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) throw new Error(`Invalid release version: ${version}`)
  return version.split('.').map(BigInt)
}
function compare(a: string, b: string) {
  const left = versionParts(a), right = versionParts(b)
  for (let i = 0; i < 3; i++) { if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1 }
  return 0
}
export function availableUpdate(value: unknown, current: string, platform: Platform): AvailableUpdate | null {
  versionParts(current)
  if (!Array.isArray(value) || !value.length) throw new Error('Release list is empty or invalid.')
  const marked = value.filter(release => release?.isLatest === true)
  if (value.some(release => release?.isLatest !== undefined && typeof release.isLatest !== 'boolean') || marked.length > 1 || (!marked.length && value.some(release => release?.isLatest !== undefined))) throw new Error('Release list must identify exactly one latest release.')
  // Older feeds already put GitHub Latest first. Historical releases remain
  // downloadable, but must never override the publisher's selected release.
  const selectedRelease = marked[0] ?? value[0]
  let latest: AvailableUpdate | null = null
  for (const release of value) {
    if (typeof release?.version !== 'string' || !release.version.startsWith('v') || !Array.isArray(release.platforms)) throw new Error('Invalid release entry.')
    const version = release.version.slice(1)
    versionParts(version)
    if (release.url !== `${repository}/releases/tag/v${version}`) throw new Error('Unexpected release URL.')
    const asset = release.platforms.find((item: { id: string }) => item?.id === platform)
    if (!asset) continue
    const selected = platform === 'windows-x64' && asset.installer ? asset.installer : asset
    const file = `YouDub-${version}-${platform === 'macos-arm64' ? 'macOS-arm64.dmg' : asset.installer ? 'windows-x64-Setup.exe' : 'windows-x64.zip'}`
    const download = `${repository}/releases/download/v${version}/${file}`
    if (selected.url !== download || selected.checksum !== download + '.sha256') throw new Error('Release asset or checksum URL is invalid.')
    if (release === selectedRelease && compare(version, current) > 0) {
      latest = { version, url: release.url, download, checksum: selected.checksum }
    }
  }
  return latest
}
export async function checkForUpdates(current: string, platform: Platform | null = updatePlatform, request = fetch) {
  if (!platform) throw new AppError('UPDATE_UNSUPPORTED', 'No desktop release is available for this platform.', 422)
  try {
    const response = await request(releasesURL, { signal: AbortSignal.timeout(15_000), redirect: 'error', cache: 'no-store', credentials: 'omit', headers: { Accept: 'application/json' } })
    if (!response.ok) throw new Error(`Release server returned HTTP ${response.status}.`)
    const available = availableUpdate(await response.json(), current, platform)
    return { currentVersion: current, available, checkedAt: new Date().toISOString() }
  } catch (error) {
    throw new AppError('UPDATE_CHECK_FAILED', `Update check failed: ${error instanceof Error ? error.message : String(error)}`, 502)
  }
}
