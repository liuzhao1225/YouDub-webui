import { cp, mkdir, readFile, readdir, rm, writeFile, access, rename, lstat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { resolve, join, basename, dirname, relative, isAbsolute } from 'node:path'
import { run, runNpm, nodeVersion, assembleRuntime, bundleNode } from './desktop-runtime.mjs'
import { appVersion, validateReleaseVersion } from './release-version.mjs'

if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Build Windows x64 on Windows x64.')
const root = resolve(import.meta.dirname, '..')
process.chdir(root)
if (process.env.GITHUB_REF_TYPE === 'tag') validateReleaseVersion(appVersion, process.env.GITHUB_REF_NAME)
const system = join(process.env.SystemRoot || 'C:/Windows', 'System32')
process.env.PATH = [dirname(process.execPath), system, process.env.PATH].filter(Boolean).join(';')
// Some Windows tar builds decode arguments with the system ANSI code page.
// Pass Unicode paths through the environment to PowerShell's ZIP implementation.
const extractZip = (archive, destination) => run(join(system, 'WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command',
  "$ErrorActionPreference = 'Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::ExtractToDirectory($env:YOUDUB_ARCHIVE, $env:YOUDUB_EXTRACT_DIR)"],
{ env: { ...process.env, YOUDUB_ARCHIVE: archive, YOUDUB_EXTRACT_DIR: destination } })

const cache = join(root, '.cache/windows')
const app = join(root, 'dist/YouDub-windows-x64')
const runtime = join(app, 'resources/runtime')
const nodeArchive = `node-v${nodeVersion}-win-x64.zip`
const webviewVersion = '1.0.4191.47'
const webviewArchive = `webview2.${webviewVersion}.zip`
const webviewHash = 'f492bbf547d0da329553b6727435b677579b1e9f91cc9e4a1ad029366d5f23d0'
const sha256 = async file => createHash('sha256').update(await readFile(file)).digest('hex')
// Guard every recursive deletion, including generated paths, to this checkout.
async function removeGenerated(path) {
  const child = relative(root, resolve(path))
  if (!child || child.startsWith('..') || isAbsolute(child)) throw new Error(`Unsafe removal: ${path}`)
  await rm(path, { recursive: true, force: true })
}
async function download(name, url) {
  const destination = join(cache, name)
  try { await access(destination); return destination }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  run(join(system, 'curl.exe'), ['-fL', '--retry', '2', '--connect-timeout', '20', '--max-time', '300', '-o', destination + '.part', url])
  await rename(destination + '.part', destination)
  return destination
}
await mkdir(cache, { recursive: true })
const archive = await download(nodeArchive, `https://nodejs.org/dist/v${nodeVersion}/${nodeArchive}`)
const sums = await download(`node-${nodeVersion}-SHASUMS256.txt`, `https://nodejs.org/dist/v${nodeVersion}/SHASUMS256.txt`)
const expected = (await readFile(sums, 'utf8')).split(/\r?\n/).find(line => line.endsWith(`  ${nodeArchive}`))?.split(' ')[0]
const nodeHash = await sha256(archive)
if (!expected || expected !== nodeHash) throw new Error('Bundled Node archive SHA-256 mismatch.')
const webview = await download(webviewArchive, `https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/${webviewVersion}/microsoft.web.webview2.${webviewVersion}.nupkg`)
if (await sha256(webview) !== webviewHash) throw new Error('WebView2 SDK SHA-256 mismatch.')
await removeGenerated(join(cache, `node-v${nodeVersion}-win-x64`))
extractZip(archive, cache)
const sdk = join(cache, `webview2-${webviewVersion}`)
await removeGenerated(sdk)
await mkdir(sdk, { recursive: true })
extractZip(webview, sdk)
if (!process.argv.includes('--reuse-web')) {
  runNpm(['--prefix', 'apps/web', 'run', 'build', '--', '--webpack'], { env: { ...process.env, YOUDUB_DESKTOP_BUILD: '1', NEXT_TELEMETRY_DISABLED: '1' } })
}
await removeGenerated(app)
await assembleRuntime(root, runtime)
await cp(join(root, 'apps/desktop/windows/bootstrap.mjs'), join(runtime, 'apps/desktop/windows/bootstrap.mjs'))
// ZIP extraction must work without Developer Mode, junctions, or this checkout.
for (const workspace of ['apps/host', 'packages/sdk', 'packages/builtin']) {
  const { name } = JSON.parse(await readFile(join(runtime, workspace, 'package.json'), 'utf8'))
  const link = join(runtime, 'node_modules', name)
  if (!(await lstat(link)).isSymbolicLink()) throw new Error(`Expected workspace junction: ${link}`)
  await removeGenerated(link)
  await cp(join(runtime, workspace), link, { recursive: true })
}
await bundleNode(join(cache, `node-v${nodeVersion}-win-x64`), join(app, 'resources'))
for (const library of ['Core', 'WinForms']) await cp(join(sdk, `lib/net462/Microsoft.Web.WebView2.${library}.dll`), join(app, `Microsoft.Web.WebView2.${library}.dll`))
await cp(join(sdk, 'runtimes/win-x64/native/WebView2Loader.dll'), join(app, 'WebView2Loader.dll'))
await cp(join(sdk, 'LICENSE.txt'), join(app, 'WEBVIEW2-LICENSE.txt'))
await cp(join(root, 'LICENSE'), join(app, 'LICENSE.txt'))
await cp(join(root, 'apps/desktop/windows/YouDub.exe.config'), join(app, 'YouDub.exe.config'))
const require = createRequire(join(root, 'apps/web/package.json'))
const sharp = require('sharp')
const images = await Promise.all([16, 32, 48, 64, 128, 256].map(size => sharp(join(root, 'apps/desktop/icon.svg')).resize(size, size).png().toBuffer()))
const header = Buffer.alloc(6 + images.length * 16)
header.writeUInt16LE(1, 2); header.writeUInt16LE(images.length, 4)
let offset = header.length
for (const [index, png] of images.entries()) {
  const size = [16, 32, 48, 64, 128, 256][index], at = 6 + index * 16
  header[at] = header[at + 1] = size === 256 ? 0 : size
  header.writeUInt16LE(1, at + 4); header.writeUInt16LE(32, at + 6)
  header.writeUInt32LE(png.length, at + 8); header.writeUInt32LE(offset, at + 12)
  offset += png.length
}
const icon = join(cache, 'YouDub.ico')
await writeFile(icon, Buffer.concat([header, ...images]))
const assembly = join(cache, 'AssemblyInfo.cs')
await writeFile(assembly, `[assembly: System.Reflection.AssemblyTitle("YouDub")]\n[assembly: System.Reflection.AssemblyVersion("${appVersion}.0")]\n[assembly: System.Reflection.AssemblyFileVersion("${appVersion}.0")]\n`)
run(join(process.env.SystemRoot || 'C:/Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'), [
  '/nologo', '/target:winexe', '/platform:x64', '/optimize+', '/utf8output', `/out:${join(app, 'YouDub.exe')}`, `/win32icon:${icon}`,
  `/win32manifest:${join(root, 'apps/desktop/windows/app.manifest')}`,
  '/reference:System.Windows.Forms.dll', '/reference:System.Drawing.dll', '/reference:System.Net.Http.dll', '/reference:System.Web.Extensions.dll',
  `/reference:${join(app, 'Microsoft.Web.WebView2.Core.dll')}`, `/reference:${join(app, 'Microsoft.Web.WebView2.WinForms.dll')}`,
  join(root, 'apps/desktop/windows/Program.cs'), assembly,
])
const git = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true })
if (git.status !== 0) throw new Error('Cannot identify source revision.')
const buildNumber = process.env.GITHUB_RUN_NUMBER || '1'
if (!/^\d+$/.test(buildNumber)) throw new Error('Build number must contain only digits.')
await writeFile(join(app, 'resources/build.json'), JSON.stringify({ version: appVersion, buildNumber, baseCommit: git.stdout.trim(), node: nodeVersion, nodeArchiveSha256: nodeHash, webview2SDK: webviewVersion, webview2SDKSha256: webviewHash, platform: 'win32-x64', builtAt: new Date().toISOString() }, null, 2) + '\n')
await cp(join(root, 'apps/desktop/windows/README.txt'), join(app, 'README.txt'))
async function check(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.env') || entry.name === 'env.txt' || /\.(p12|p8|key)$/i.test(entry.name)) throw new Error(`Private file in bundle: ${join(directory, entry.name)}`)
    if (entry.isSymbolicLink()) throw new Error(`Link in portable bundle: ${join(directory, entry.name)}`)
    if (entry.isDirectory()) await check(join(directory, entry.name))
  }
}
await check(app)
const zip = join(root, `dist/YouDub-${appVersion}-windows-x64.zip`)
// Use ZipFile rather than Compress-Archive, which omits hidden files.
run(join(system, 'WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command',
  "$ErrorActionPreference = 'Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; if (Test-Path -LiteralPath $env:YOUDUB_ZIP) { Remove-Item -LiteralPath $env:YOUDUB_ZIP }; [IO.Compression.ZipFile]::CreateFromDirectory($env:YOUDUB_BUNDLE, $env:YOUDUB_ZIP, [IO.Compression.CompressionLevel]::Optimal, $true)"], { env: { ...process.env, YOUDUB_BUNDLE: app, YOUDUB_ZIP: zip } })
await writeFile(zip + '.sha256', `${await sha256(zip)}  ${basename(zip)}\n`)
console.log(`Built ${zip}`)

// The installer and portable ZIP contain the same built application.
const compiler = process.env.YOUDUB_ISCC || join(process.env['ProgramFiles(x86)'] || 'C:/Program Files (x86)', 'Inno Setup 6/ISCC.exe')
await access(compiler)
run(compiler, [`/DAppVersion=${appVersion}`, `/DRepoRoot=${root}`, join(root, 'apps/desktop/windows/installer.iss')])
const installer = join(root, `dist/YouDub-${appVersion}-windows-x64-Setup.exe`)
await writeFile(installer + '.sha256', `${await sha256(installer)}  ${basename(installer)}\n`)
console.log(`Built ${installer}`)
