/** Electron-updater metadata for the exact immutable artifacts published in one GitHub Release. */
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, writeFile, stat } from 'node:fs/promises'
import { join, basename, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const desktopUpdateURL = 'https://github.com/liuzhao1225/YouDub-webui/releases/latest/download/'
export const desktopUpdateConfig = { provider: 'generic', url: desktopUpdateURL, updaterCacheDirName: 'youdub-updater' }
const platforms = { darwin: ['macOS-arm64.zip', 'latest-mac.yml'], win32: ['windows-x64-Setup.exe', 'latest.yml'] }
export async function hashFile(file, algorithm, encoding) {
  const hash = createHash(algorithm)
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest(encoding)
}
export async function writeUpdateFeed(directory, version, platform) {
  if (!/^\d+\.\d+\.\d+$/.test(version) || !platforms[platform]) throw new Error('Invalid desktop update version or platform')
  const [suffix, channel] = platforms[platform]
  const file = `YouDub-${version}-${suffix}`
  const artifact = join(directory, file)
  const url = `https://github.com/liuzhao1225/YouDub-webui/releases/download/v${version}/${file}`
  const sha512 = await hashFile(artifact, 'sha512', 'base64')
  // JSON is a YAML subset; no serializer-dependent escaping of release asset URLs.
  const metadata = { version, files: [{ url, sha512, size: (await stat(artifact)).size }], path: url, sha512 }
  const output = join(directory, channel)
  await writeFile(output, JSON.stringify(metadata, null, 2) + '\n')
  for (const path of [artifact, output]) await writeFile(path + '.sha256', `${await hashFile(path, 'sha256', 'hex')}  ${basename(path)}\n`)
  await verifyUpdateFeed(directory, version, platform)
}
export async function verifyUpdateFeed(directory, version, platform) {
  const [suffix, channel] = platforms[platform]
  const file = `YouDub-${version}-${suffix}`
  const metadata = JSON.parse(await readFile(join(directory, channel), 'utf8'))
  const artifact = join(directory, file)
  const url = `https://github.com/liuzhao1225/YouDub-webui/releases/download/v${version}/${file}`
  const sha512 = await hashFile(artifact, 'sha512', 'base64')
  if (metadata.version !== version || metadata.files?.length !== 1 || metadata.files[0].url !== url
    || metadata.path !== url || metadata.sha512 !== sha512 || metadata.files[0].sha512 !== sha512
    || metadata.files[0].size !== (await stat(artifact)).size) throw new Error(`Invalid ${channel}: artifact/version/hash mismatch`)
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [operation, directory, version, platform] = process.argv.slice(2)
  if (!['write', 'verify'].includes(operation)) throw new Error('Usage: desktop-update-feed.mjs write|verify <directory> <version> darwin|win32')
  await (operation === 'write' ? writeUpdateFeed : verifyUpdateFeed)(directory, version, platform)
}
