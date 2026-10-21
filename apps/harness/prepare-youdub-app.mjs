import { build } from 'esbuild'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { access, lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

if (process.platform !== 'darwin') throw new Error('YouDub.app is a macOS development application.')
const here = fileURLToPath(new URL('.', import.meta.url))
const root = resolve(here, '../..')
const output = join(here, 'dist/desktop')
const cache = join(root, '.cache/harness')
const bundle = join(cache, 'YouDub.app')
const temporary = join(cache, 'development-bundle')
const home = resolve(process.env.DSH_HOME || join(cache, 'desktop'))
const userData = home + '-user-data'
const runtime = join(cache, 'runtime/primary-runtime')
const runtimeProject = join(output, 'runtime-project')
const pnpm = join(runtime, 'dependencies/pnpm/bin/pnpm.mjs')
const require = createRequire(import.meta.url)
const electron = require('electron')
const productVersion = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version
const lsregister = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister'
const helper = join(output, 'development-app.mjs')
const upstreamEntry = join(root, 'vendor/deepseek-harness/source/apps/desktop/scripts/development-app.ts')
for (const path of [join(output, 'main.mjs'), join(runtimeProject, 'desktop-runtime.json'), runtime, pnpm]) await access(path)
await mkdir(temporary, { recursive: true })
const { metafile } = await build({ absWorkingDir: here, entryPoints: [upstreamEntry], outfile: helper,
  bundle: true, platform: 'node', format: 'esm', target: 'node24', packages: 'external', metafile: true })
await writeFile(join(output, 'development-app-inputs.json'), JSON.stringify(metafile, null, 2) + '\n')
const { prepareDevelopmentApp } = await import(pathToFileURL(helper))

// The unchanged helper assembles and signs its temporary development bundle.
// Its debug launcher is never executed. Product startup is configured below.
const temporaryExecutable = prepareDevelopmentApp({ electron, appRoot: output, directory: temporary, home, userData,
  mainPort: 0, rendererPort: 0, hostPort: 0, openDevtools: '0' })
const temporaryBundle = resolve(dirname(temporaryExecutable), '../..')
execFileSync(lsregister, ['-u', temporaryBundle], { stdio: 'pipe' })
let exists = false
try { await lstat(bundle); exists = true } catch (error) { if (error.code !== 'ENOENT') throw error }
if (exists) {
  const previous = JSON.parse(await readFile(join(bundle, 'Contents/Resources/youdub-development.json'), 'utf8'))
  if (previous.root !== root) throw new Error(`Another workspace owns ${bundle}`)
  execFileSync(lsregister, ['-u', bundle], { stdio: 'pipe' })
  await rm(bundle, { recursive: true })
}
await rename(temporaryBundle, bundle)
const plist = join(bundle, 'Contents/Info.plist')
for (const [key, value] of Object.entries({
  CFBundleIdentifier: `ai.xiaoke.youdub.development.${createHash('sha256').update(root).digest('hex').slice(0, 12)}`,
  CFBundleName: 'YouDub', CFBundleDisplayName: 'YouDub', CFBundleExecutable: 'YouDub',
  CFBundleShortVersionString: productVersion, CFBundleVersion: productVersion.split('-')[0], CFBundleIconFile: 'YouDub.icns',
})) execFileSync('/usr/bin/plutil', ['-replace', key, '-json', JSON.stringify(value), plist])
// Reuse the original YouDub macOS icon pipeline from scripts/build-mac.mjs.
const webRequire = createRequire(join(root, 'apps/web/package.json'))
const sharp = webRequire('sharp')
const iconset = join(cache, 'YouDub.iconset')
await mkdir(iconset, { recursive: true })
for (const size of [16, 32, 128, 256, 512]) for (const scale of [1, 2]) {
  await sharp(join(root, 'apps/desktop/icon.svg')).resize(size * scale, size * scale).png().toFile(join(iconset, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`))
}
execFileSync('/usr/bin/iconutil', ['-c', 'icns', iconset, '-o', join(bundle, 'Contents/Resources/YouDub.icns')])
execFileSync('/usr/bin/plutil', ['-remove', 'CFBundleURLTypes', plist])
const quote = value => `'${value.replaceAll("'", "'\\''")}'`
const environment = { DSH_DESKTOP_DSH_DIR: runtimeProject,
  DSH_DESKTOP_PRIMARY_RUNTIME_DIR: runtime, DSH_DESKTOP_PNPM_ENTRY: pnpm, DSH_DESKTOP_OPEN_DEVTOOLS: '0' }
// Harness reads its official environment/profile layers on every cold start. No credentials or
// media-provider settings are copied into this generated launcher.
const launcher = ['#!/bin/sh',
  'unset ELECTRON_RUN_AS_NODE DSH_DESKTOP_DEV_APP DSH_DESKTOP_HOST_INSPECT_PORT',
  `if [ -z \"\${DSH_HOME:-}\" ]; then export DSH_HOME=${quote(home)}; fi`,
  ...Object.entries(environment).map(([key, value]) => `export ${key}=${quote(value)}`),
  `cd ${quote(root)}`,
  `exec ${quote(join(bundle, 'Contents/MacOS/Electron'))} "--user-data-dir=\${DSH_HOME}-user-data" ${quote(output)} "$@"`, '',
].join('\n')
await rename(join(bundle, 'Contents/MacOS/HarnessDev'), join(bundle, 'Contents/MacOS/YouDub'))
await writeFile(join(bundle, 'Contents/MacOS/YouDub'), launcher, { mode: 0o755 })
await writeFile(join(bundle, 'Contents/Resources/youdub-development.json'), JSON.stringify({ root, output, home, userData,
  upstreamHelper: 'apps/desktop/scripts/development-app.ts',
  productIcon: { source: 'apps/desktop/icon.svg', buildMethod: 'scripts/build-mac.mjs',
    sourceSha256: createHash('sha256').update(await readFile(join(root, 'apps/desktop/icon.svg'))).digest('hex'),
    sha256: createHash('sha256').update(await readFile(join(bundle, 'Contents/Resources/YouDub.icns'))).digest('hex') }, development: true, debugListeners: false, registeredUrlSchemes: [] }, null, 2) + '\n')
execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', bundle], { stdio: 'pipe' })
execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle], { stdio: 'pipe' })
execFileSync(lsregister, ['-f', bundle], { stdio: 'pipe' })
console.log(`YouDub development application: ${bundle}\nCold-start launcher: ${join(bundle, 'Contents/MacOS/YouDub')}\nNo debug listeners or URL schemes are configured.`)
