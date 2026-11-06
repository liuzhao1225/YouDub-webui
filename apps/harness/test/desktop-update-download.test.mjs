/** Real Electron transport + electron-updater checksum/cache path, without installing a test payload. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
const require = createRequire(new URL('../package.json', import.meta.url))
const root = resolve(import.meta.dirname, '../../..')

test('real Electron downloads automatically, rejects corrupted bytes, reuses verified cache and never installs', { timeout: 60_000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'YouDub update transport '))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const payload = Buffer.alloc(256 * 1024, 67)
  const sha512 = createHash('sha512').update(payload).digest('base64')
  let corrupt = true, downloads = 0
  const suffix = process.platform === 'darwin' ? 'macOS-arm64.zip' : 'windows-x64-Setup.exe'
  const file = 'YouDub-1.0.1-' + suffix
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost')
    if (url.pathname.endsWith('.yml')) {
      response.setHeader('content-type', 'application/yaml')
      response.end(JSON.stringify({ version: '1.0.1', files: [{ url: file, sha512, size: payload.length }], path: file, sha512 }))
    } else if (url.pathname === '/' + file) {
      downloads++
      response.setHeader('content-length', payload.length)
      response.end(corrupt ? Buffer.alloc(payload.length, 68) : payload)
    } else if (url.pathname === '/valid') { corrupt = false; response.end() }
    else { response.writeHead(404); response.end() }
  })
  // Port 0 asks the OS to reserve an unused port atomically.
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const feed = `http://127.0.0.1:${server.address().port}/`
  const output = join(directory, 'result.json'), entry = join(directory, 'update-test.cjs')
  await build({ stdin: { contents: `
    import { app } from 'electron'
    import { writeFile, mkdir } from 'node:fs/promises'
    import { join } from 'node:path'
    import { DesktopUpdateCoordinator } from './vendor/deepseek-harness/source/apps/desktop/src/update-coordinator.ts'
    import { YouDubInnoUpdater } from './apps/harness/src/desktop-inno-updater.ts'
    import { MacUpdater } from 'electron-updater'
    void (async () => {
      app.setPath('userData', ${JSON.stringify(join(directory, 'electron'))})
      await app.whenReady()
      const directory = ${JSON.stringify(directory)}
      const config = join(directory, 'app-update.yml')
      await writeFile(config, JSON.stringify({ provider: 'generic', url: ${JSON.stringify(feed)}, updaterCacheDirName: 'test-cache' }))
      let installed = false
      const adapter = { version: '1.0.0', name: 'YouDub', isPackaged: true, appUpdateConfigPath: config,
        userDataPath: directory, baseCachePath: directory, whenReady: async () => {}, onQuit: () => {},
        quit: () => { installed = true }, relaunch: () => { installed = true } }
      const create = () => {
        const updater = process.platform === 'darwin' ? new MacUpdater(null, adapter) : new YouDubInnoUpdater(null, adapter)
        const states = []
        const coordinator = new DesktopUpdateCoordinator(state => { states.push(state); return state }, async () => { installed = true; return false }, updater, () => true, () => '1.0.0')
        return { updater, coordinator, states }
      }
      const first = create()
      const failed = await first.coordinator.check()
      const retainedFailure = await first.coordinator.check()
      await fetch(${JSON.stringify(feed + 'valid')})
      const ready = await first.coordinator.download('1.0.1')
      first.coordinator.dispose()
      if (first.updater.closeServerIfExists) first.updater.closeServerIfExists()
      const cached = create()
      const reused = await cached.coordinator.check()
      cached.coordinator.dispose()
      if (cached.updater.closeServerIfExists) cached.updater.closeServerIfExists()
      await writeFile(${JSON.stringify(output)}, JSON.stringify({ failed, retainedFailure, ready, reused, installed, states: first.states }))
      app.exit(0)
    })().catch(error => { console.error(error); app.exit(1) })
  `, resolveDir: root, loader: 'ts' }, bundle: true, format: 'cjs', platform: 'node', external: ['electron'],
    nodePaths: [join(root, 'apps/harness/node_modules')], outfile: entry, logLevel: 'silent' })
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  try { await promisify(execFile)(require('electron'), [entry], { env, timeout: 45_000 }) }
  catch (error) { throw new Error(`Electron update transport failed: ${error.stdout}\n${error.stderr}`, { cause: error }) }
  const result = JSON.parse(await readFile(output, 'utf8'))
  assert.equal(result.failed.phase, 'error')
  assert.match(result.failed.message, /sha512|checksum/i)
  assert.deepEqual(result.retainedFailure, result.failed)
  assert.equal(result.ready.phase, 'ready')
  assert.equal(result.reused.phase, 'ready')
  assert.equal(result.installed, false)
  assert.equal(downloads, 2, 'failed checks must not retry downloads; verified cache must not download again')
})
