import { cp, mkdir, readFile, readdir, rm, writeFile, access } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { resolve, join } from 'node:path'
import { run, runNpm, nodeVersion, nodeChecksumFilename, assembleRuntime, bundleNode } from './desktop-runtime.mjs'
import { appVersion, validateReleaseVersion } from './release-version.mjs'

if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('This build targets macOS arm64 and must run on Apple Silicon.')
const root = resolve(import.meta.dirname, '..')
process.chdir(root)
if (process.env.GITHUB_REF_TYPE === 'tag') validateReleaseVersion(appVersion, process.env.GITHUB_REF_NAME)
const version = nodeVersion
const cache = join(root, '.cache/mac')
const archive = `node-v${version}-darwin-arm64.tar.gz`
await mkdir(cache, { recursive: true })
const checksumFile = nodeChecksumFilename(version)
for (const [file, cached] of [[archive, archive], ['SHASUMS256.txt', checksumFile]]) {
  try { await access(join(cache, cached)) }
  catch (error) {
    if (error.code !== 'ENOENT') throw error
    run('curl', ['-fL', '--connect-timeout', '20', '-o', join(cache, cached), `https://nodejs.org/dist/v${version}/${file}`])
  }
}
const expected = (await readFile(join(cache, checksumFile), 'utf8')).split('\n').find(line => line.endsWith(`  ${archive}`))?.split(' ')[0]
const actual = createHash('sha256').update(await readFile(join(cache, archive))).digest('hex')
if (!expected || expected !== actual) throw new Error('Bundled Node archive SHA-256 mismatch.')
run('tar', ['-xzf', join(cache, archive), '-C', cache])
if (!process.argv.includes('--reuse-web')) {
  runNpm(['--prefix', 'apps/web', 'run', 'build'])
}
const app = join(root, 'dist/YouDub.app')
await rm(app, { recursive: true, force: true })
const resources = join(app, 'Contents/Resources')
const runtime = join(resources, 'runtime')
await mkdir(join(app, 'Contents/MacOS'), { recursive: true })
await assembleRuntime(root, runtime)
await bundleNode(join(cache, `node-v${version}-darwin-arm64`), resources)
const buildNumber = process.env.GITHUB_RUN_NUMBER || '1'
if (!/^\d+$/.test(buildNumber)) throw new Error('Build number must contain only digits.')
const plist = (await readFile(join(root, 'apps/desktop/Info.plist'), 'utf8'))
  .replace('__APP_VERSION__', appVersion).replace('__BUILD_NUMBER__', buildNumber)
await writeFile(join(app, 'Contents/Info.plist'), plist)
run('xcrun', ['swiftc', '-O', '-target', 'arm64-apple-macos14.0', '-framework', 'AppKit', '-framework', 'WebKit', 'apps/desktop/main.swift', '-o', join(app, 'Contents/MacOS/YouDub')])
const require = createRequire(join(root, 'apps/web/package.json'))
const sharp = require('sharp')
const iconset = join(cache, 'YouDub.iconset')
await mkdir(iconset, { recursive: true })
for (const size of [16, 32, 128, 256, 512]) for (const scale of [1, 2]) {
  await sharp(join(root, 'apps/desktop/icon.svg')).resize(size * scale, size * scale).png().toFile(join(iconset, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`))
}
run('iconutil', ['-c', 'icns', iconset, '-o', join(resources, 'YouDub.icns')])
const git = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' })
if (git.status !== 0) throw new Error('Cannot identify source revision.')
await writeFile(join(resources, 'build.json'), JSON.stringify({ version: appVersion, buildNumber, baseCommit: git.stdout.trim(), node: version, nodeArchiveSha256: actual, platform: 'darwin-arm64', builtAt: new Date().toISOString() }, null, 2) + '\n')
async function check(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === '.env' || entry.name === 'env.txt' || /\.(p12|p8|key)$/.test(entry.name)) throw new Error(`Private file in bundle: ${join(directory, entry.name)}`)
    if (entry.isDirectory()) await check(join(directory, entry.name))
  }
}
await check(app)
console.log(`Built ${app}`)
