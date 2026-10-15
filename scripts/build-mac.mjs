import { cp, mkdir, readFile, readdir, rm, writeFile, access } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { resolve, join, basename } from 'node:path'
import { appVersion, validateReleaseVersion } from './release-version.mjs'

if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('This build targets macOS arm64 and must run on Apple Silicon.')
const root = resolve(import.meta.dirname, '..')
process.chdir(root)
if (process.env.GITHUB_REF_TYPE === 'tag') validateReleaseVersion(appVersion, process.env.GITHUB_REF_NAME)
const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} failed (${result.status}).`)
}
const version = '22.23.2'
const cache = join(root, '.cache/mac')
const archive = `node-v${version}-darwin-arm64.tar.gz`
await mkdir(cache, { recursive: true })
for (const file of [archive, 'SHASUMS256.txt']) {
  try { await access(join(cache, file)) }
  catch (error) {
    if (error.code !== 'ENOENT') throw error
    run('curl', ['-fL', '--connect-timeout', '20', '-o', join(cache, file), `https://nodejs.org/dist/v${version}/${file}`])
  }
}
const expected = (await readFile(join(cache, 'SHASUMS256.txt'), 'utf8')).split('\n').find(line => line.endsWith(`  ${archive}`))?.split(' ')[0]
const actual = createHash('sha256').update(await readFile(join(cache, archive))).digest('hex')
if (!expected || expected !== actual) throw new Error('Bundled Node archive SHA-256 mismatch.')
run('tar', ['-xzf', join(cache, archive), '-C', cache])
if (!process.argv.includes('--reuse-web')) {
  run('npm', ['--prefix', 'apps/web', 'run', 'build', '--', '--webpack'], { env: { ...process.env, YOUDUB_DESKTOP_BUILD: '1' } })
}
const app = join(root, 'dist/YouDub.app')
await rm(app, { recursive: true, force: true })
const resources = join(app, 'Contents/Resources')
const runtime = join(resources, 'runtime')
await mkdir(join(app, 'Contents/MacOS'), { recursive: true })
await mkdir(runtime, { recursive: true })
const filter = file => !['.git', '__pycache__', '.venv', 'node_modules', '.pytest_cache', '.DS_Store'].includes(basename(file)) && !basename(file).startsWith('.env') && basename(file) !== 'env.txt'
for (const file of ['package.json', 'package-lock.json', 'tsconfig.json', 'youdub.config.ts', 'requirements.txt', 'LICENSE', 'apps/host', 'packages/sdk', 'packages/builtin', 'backend/app', 'backend/workers', 'submodule/demucs', 'apps/desktop/server.mjs', 'apps/web/plugin-dist']) {
  await cp(join(root, file), join(runtime, file), { recursive: true, filter })
}
// Use the repository lockfile; tsx is needed to load Cordis's TypeScript plugins.
run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund', '--registry=https://registry.npmmirror.com'], { cwd: runtime })
await cp(join(root, 'apps/web/.next-desktop/standalone'), join(runtime, 'web'), { recursive: true, dereference: true, filter: file => !basename(file).startsWith('.env') && basename(file) !== 'env.txt' })
await cp(join(root, 'apps/web/.next-desktop/static'), join(runtime, 'web/apps/web/.next-desktop/static'), { recursive: true })
await cp(join(root, 'apps/web/public'), join(runtime, 'web/apps/web/public'), { recursive: true })
await access(join(runtime, 'web/apps/web/server.js'))
await cp(join(cache, `node-v${version}-darwin-arm64/bin/node`), join(resources, 'node'))
run(join(resources, 'node'), ['-e', 'require.resolve("next")'], { cwd: join(runtime, 'web/apps/web') })
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
