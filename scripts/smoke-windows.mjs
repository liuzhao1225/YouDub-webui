import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, readdir, writeFile, cp, rm } from 'node:fs/promises'
import { join, resolve, basename, relative, isAbsolute } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { appVersion } from './release-version.mjs'
import { demos } from '../site/demos.js'

if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Run this smoke test on Windows x64 with WebView2 installed.')
const root = resolve(import.meta.dirname, '..')
const zip = resolve(process.argv[2] || join(root, `dist/YouDub-${appVersion}-windows-x64.zip`))
const hash = content => createHash('sha256').update(content).digest('hex')
const digest = hash(await readFile(zip))
assert.equal(digest, (await readFile(zip + '.sha256', 'utf8')).trim().split(/\s+/)[0], 'ZIP checksum')
const cache = join(root, '.cache/windows-smoke')
await mkdir(cache, { recursive: true })
const work = await mkdtemp(join(cache, 'run-'))
const destination = join(work, '安装 空格')
const data = join(work, '用户 数据')
await mkdir(destination)
const system = join(process.env.SystemRoot || 'C:/Windows', 'System32')
console.log('Extracting verified ZIP into a path containing Chinese characters and spaces...')
// ZipFile uses Unicode paths even on runners whose ANSI code page is English.
const extract = spawnSync(join(system, 'WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command',
  "$ErrorActionPreference = 'Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::ExtractToDirectory($env:YOUDUB_ARCHIVE, $env:YOUDUB_EXTRACT_DIR)"],
{ stdio: 'inherit', windowsHide: true, env: { ...process.env, YOUDUB_ARCHIVE: zip, YOUDUB_EXTRACT_DIR: destination } })
if (extract.error) throw extract.error
assert.equal(extract.status, 0, 'ZIP extraction')
const app = join(destination, 'YouDub-windows-x64')
const build = JSON.parse(await readFile(join(app, 'resources/build.json'), 'utf8'))
assert.equal(build.version, appVersion)
assert.equal(build.platform, 'win32-x64')
const bundledNpm = spawnSync(join(app, 'resources/node.exe'), [join(app, 'resources/node_modules/npm/bin/npm-cli.js'), '--version'], { encoding: 'utf8', windowsHide: true })
assert.equal(bundledNpm.status, 0, bundledNpm.stderr)
assert.match(bundledNpm.stdout.trim(), /^\d+\.\d+\.\d+$/, 'Bundled npm must run without a global Node installation')
const sdkImport = spawnSync(join(app, 'resources/node.exe'), ['--input-type=module', '-e', 'import {SDK_VERSION, AppError} from "@youdub/sdk"; if(SDK_VERSION!=="1.0.0" || !(new AppError("TEST","test") instanceof Error))process.exit(1)'], { cwd: join(app, 'resources/runtime'), encoding: 'utf8', windowsHide: true })
assert.equal(sdkImport.status, 0, sdkImport.stderr)
if (process.env.GITHUB_SHA) assert.equal(build.baseCommit, process.env.GITHUB_SHA)
async function snapshot(directory, prefix = '') {
  const files = {}
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name), key = prefix + entry.name
    assert.ok(!entry.isSymbolicLink(), `Portable package contains a link: ${key}`)
    if (entry.isDirectory()) Object.assign(files, await snapshot(path, key + '/'))
    else files[key] = hash(await readFile(path))
  }
  return files
}
console.log('Hashing the extracted application before startup...')
const before = await snapshot(app)
const active = new Set()
const records = []
function launch(mode, name) {
  const report = join(work, name + '.json')
  // Deterministic, offline first-run failure: never download models in packaging CI.
  // This is a documented explicit Python override, not a mocked server or WebView.
  const child = spawn(join(app, 'YouDub.exe'), [mode, report], {
    cwd: work, windowsHide: true, stdio: 'ignore',
    env: { ...process.env, YOUDUB_DESKTOP_DATA_DIR: data, YOUDUB_PYTHON: join(data, 'missing-python.exe') },
  })
  active.add(child)
  const exited = new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => { active.delete(child); resolve({ code, signal }) })
  })
  void exited.catch(() => {})
  return { child, exited, report }
}
async function readReport(instance) {
  const deadline = Date.now() + 150000
  while (Date.now() < deadline) {
    try { return JSON.parse(await readFile(instance.report, 'utf8')) }
    catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error }
    if (instance.child.exitCode !== null || instance.child.signalCode !== null) throw new Error(`Launcher exited before reporting: ${JSON.stringify(await instance.exited)}`)
    await delay(100)
  }
  throw new Error(`Launcher timed out; inspect ${join(data, 'logs/desktop.log')}`)
}
async function exitWithin(instance) {
  const timeout = AbortSignal.timeout(40000)
  const deadline = new Promise((_, reject) => timeout.addEventListener('abort', () => reject(new Error('Launcher did not exit within 40 seconds.')), { once: true }))
  return Promise.race([instance.exited, deadline])
}
function alive(pid) {
  try { process.kill(pid, 0); return true }
  catch (error) { if (error.code === 'ESRCH') return false; throw error }
}
async function stopped(pids, url) {
  const deadline = Date.now() + 10000
  while (pids.some(alive) && Date.now() < deadline) await delay(100)
  assert.deepEqual(pids.filter(alive), [], 'Desktop child processes must exit')
  await assert.rejects(fetch(url, { signal: AbortSignal.timeout(2000) }), 'Gateway must stop listening')
}
function nodeChildren(pid) {
  const result = spawnSync(join(system, 'WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command',
    '$ErrorActionPreference = "Stop"; Get-CimInstance Win32_Process -Filter ("ParentProcessId = " + $env:YOUDUB_PARENT_PID) | Select-Object -ExpandProperty ProcessId'],
  { env: { ...process.env, YOUDUB_PARENT_PID: String(pid) }, encoding: 'utf8', windowsHide: true })
  if (result.error) throw result.error
  assert.equal(result.status, 0, result.stderr)
  const pids = result.stdout.trim().split(/\s+/).filter(Boolean).map(Number)
  assert.ok(pids.length > 0, 'Expected the Next child process')
  return pids
}
try {
  console.log('Testing extracted executable, WebView2 rendering and graceful shutdown...')
  const normal = launch('--smoke-test', 'normal')
  const first = await readReport(normal)
  assert.equal(first.ok, true, first.error)
  assert.equal((await exitWithin(normal)).code, 0, 'Graceful shutdown')
  await stopped([first.serverPid, first.browserPid], first.url)
  records.push({ test: 'native-launch-render-shutdown', ...first })
  await cp(normal.report + '.png', join(root, 'dist/windows-smoke.png'))

  console.log('Testing data-directory lock and process cleanup after launcher termination...')
  const held = launch('--smoke-hold', 'held')
  const second = await readReport(held)
  assert.equal(second.ok, true, second.error)
  const descendants = nodeChildren(second.serverPid)
  const duplicate = launch('--smoke-test', 'duplicate')
  const rejected = await readReport(duplicate)
  assert.equal(rejected.ok, false, 'Second instance must reject the locked data directory')
  assert.match(rejected.error, /已有 YouDub 桌面实例/)
  assert.equal((await exitWithin(duplicate)).code, 1)
  assert.ok((await fetch(second.url)).ok, 'Existing instance remains available')
  for (const id of Object.keys(demos)) for (const suffix of ['en.mp4', 'zh.mp4', 'poster.jpg']) {
    const response = await fetch(new URL(`/examples/assets/${id}-${suffix}`, second.url), { signal: AbortSignal.timeout(10000) })
    assert.equal(response.status, 200, `Bundled example ${id}-${suffix}`)
    assert.ok((await response.arrayBuffer()).byteLength > 0)
  }
  records.push({ test: 'bundled-offline-examples', ok: true, examples: Object.keys(demos) })
  held.child.kill()
  await exitWithin(held)
  await stopped([second.serverPid, second.browserPid, ...descendants], second.url)
  records.push({ test: 'single-instance-and-crash-cleanup', ok: true, childPids: descendants })

  // A killed launcher must release the lock so the same user can reopen the app.
  const reopened = launch('--smoke-test', 'reopened')
  const third = await readReport(reopened)
  assert.equal(third.ok, true, third.error)
  assert.equal((await exitWithin(reopened)).code, 0)
  await stopped([third.serverPid, third.browserPid], third.url)
  assert.deepEqual(await snapshot(app), before, 'Running the desktop must not modify its application bundle')
  records.push({ test: 'reopen-and-bundle-immutability', ok: true, files: Object.keys(before).length })
  await writeFile(join(root, 'dist/windows-smoke.json'), JSON.stringify({ ok: true, archive: basename(zip), sha256: digest, build, records, testedAt: new Date().toISOString(), limitations: ['Uses an explicit missing Python override to test first-run error rendering without model downloads.', 'Does not validate model installation, CUDA, video inference or Authenticode signing.'] }, null, 2) + '\n')
  console.log('Windows ZIP, native WebView2 pages, single-instance lock, graceful/crash shutdown and immutable bundle: passed.')
} catch (error) {
  console.error(`Smoke diagnostics retained at ${work}`)
  try { console.error(await readFile(join(data, 'logs/desktop.log'), 'utf8')) } catch {}
  throw error
} finally {
  for (const child of active) child.kill()
}
// Only remove the exact generated subtree, after every launcher has stopped.
const child = relative(cache, work)
if (!child || child.startsWith('..') || isAbsolute(child)) throw new Error(`Unsafe cleanup path: ${work}`)
await rm(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
