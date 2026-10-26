import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type RequestListener } from 'node:http'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DownloadClient, fileSize } from '../src/setup-download.js'
import { assertSupportedPlatform } from '../src/setup-environment.js'

const data = Buffer.from('actual model bytes for range and integrity verification')
const sha256 = createHash('sha256').update(data).digest('hex')
async function fixture(t: any, handler: RequestListener) {
  const root = await mkdtemp(join(tmpdir(), 'youdub-setup-'))
  const server = createServer(handler)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as { port: number }
  const client = new DownloadClient()
  t.after(async () => { await client.close(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); await rm(root, { recursive: true }) })
  return { root, client, file: { path: 'model.bin', size: data.length, sha256, url: `http://127.0.0.1:${address.port}/model` }, target: join(root, 'model.bin') }
}

test('resumes an existing partial file, verifies hash, and reuses the verified result without another request', async t => {
  const ranges: string[] = []
  const { client, file, target } = await fixture(t, (request, response) => {
    ranges.push(request.headers.range || '')
    const offset = Number(request.headers.range?.match(/bytes=(\d+)-/)?.[1] || 0)
    response.writeHead(offset ? 206 : 200, { 'Content-Length': data.length - offset, ...(offset ? { 'Content-Range': `bytes ${offset}-${data.length - 1}/${data.length}` } : {}) })
    response.end(data.subarray(offset))
  })
  await writeFile(target + '.part', data.subarray(0, 7))
  const progress: number[] = []
  await client.download(file, target, new AbortController().signal, value => progress.push(value))
  assert.deepEqual(await readFile(target), data)
  assert.equal(progress[0], 7)
  assert.deepEqual(ranges, ['bytes=0-0', 'bytes=7-'])
  await client.download(file, target, new AbortController().signal, () => {})
  assert.equal(ranges.length, 2)
})

test('checksum failures remain errors, never publish the final model, and do not retry', async t => {
  let requests = 0
  const { client, file, target } = await fixture(t, (_request, response) => { requests++; response.end(Buffer.alloc(data.length, 1)) })
  await assert.rejects(client.download(file, target, new AbortController().signal, () => {}), /下载校验失败/)
  assert.equal(await fileSize(target), 0)
  assert.equal(await fileSize(target + '.part'), data.length)
  assert.equal(requests, 2)
})

test('setup downloads connect directly despite an unusable environment proxy', async t => {
  const previous = { HTTP_PROXY: process.env.HTTP_PROXY, HTTPS_PROXY: process.env.HTTPS_PROXY, NO_PROXY: process.env.NO_PROXY }
  Object.assign(process.env, { HTTP_PROXY: 'http://127.0.0.1:1', HTTPS_PROXY: 'http://127.0.0.1:1', NO_PROXY: '' })
  t.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value } })
  const { client, file, target } = await fixture(t, (_request, response) => response.end(data))
  await client.download(file, target, new AbortController().signal, () => {})
  assert.deepEqual(await readFile(target), data)
})

test('a server ignoring Range fails without truncating the saved partial download', async t => {
  const { client, file, target } = await fixture(t, (_request, response) => response.end(data))
  await writeFile(target + '.part', data.subarray(0, 7))
  await assert.rejects(client.download(file, target, new AbortController().signal, () => {}), /未接受断点/)
  assert.equal(await fileSize(target + '.part'), 7)
  assert.equal(await fileSize(target), 0)
})

test('pause preserves written bytes and explicitly resumed transfer succeeds', async t => {
  const { client, file, target } = await fixture(t, (request, response) => {
    const offset = Number(request.headers.range?.match(/bytes=(\d+)-/)?.[1] || 0)
    response.writeHead(offset ? 206 : 200, { 'Content-Length': data.length - offset, ...(offset ? { 'Content-Range': `bytes ${offset}-${data.length - 1}/${data.length}` } : {}) })
    if (offset) { response.end(data.subarray(offset)); return }
    response.write(data.subarray(0, 7))
    const timer = setTimeout(() => response.end(data.subarray(7)), 200)
    response.on('close', () => clearTimeout(timer))
  })
  const controller = new AbortController()
  await assert.rejects(client.download(file, target, controller.signal, bytes => { if (bytes >= 7) controller.abort(new Error('Paused by user')) }), /Paused by user|abort/i)
  assert.equal(await fileSize(target), 0)
  assert.equal(await fileSize(target + '.part'), 7)
  await client.download(file, target, new AbortController().signal, () => {})
  assert.deepEqual(await readFile(target), data)
})

test('OS/architecture chooses native installers and rejects unsupported platforms', () => {
  for (const [platform, arch] of [['darwin', 'arm64'], ['darwin', 'x64'], ['linux', 'arm64'], ['linux', 'x64'], ['win32', 'x64']] as const) assert.doesNotThrow(() => assertSupportedPlatform(platform, arch))
  assert.throws(() => assertSupportedPlatform('win32', 'arm64'), /暂不支持/)
})

test('preflight selects the official source without touching an available mirror', async t => {
  const urls: string[] = []
  const { client, file, target } = await fixture(t, (request, response) => { urls.push(request.url!); response.end(data) })
  await client.download({ ...file, mirrors: [file.url + '/mirror'] }, target, new AbortController().signal, () => {})
  assert.deepEqual(urls, ['/model', '/model'])
})

test('a failed official probe selects the mirror and preserves the original failure in source events', async t => {
  const events: Array<{ status: string; url: string; error?: string }> = [], urls: string[] = []
  const { client, file, target } = await fixture(t, (request, response) => {
    urls.push(request.url!)
    if (request.url === '/model') { response.writeHead(503); response.end('official unavailable') }
    else response.end(data)
  })
  await client.download({ ...file, mirrors: [file.url + '/mirror'] }, target, new AbortController().signal, () => {}, event => events.push(event))
  assert.deepEqual(urls, ['/model', '/model/mirror', '/model/mirror'])
  assert.deepEqual(events.map(event => event.status), ['checking', 'failed', 'checking', 'selected'])
  assert.match(events[1]!.error!, /HTTP 503/)
  assert.deepEqual(await readFile(target), data)
})

test('a download failing after a successful probe still switches sources and keeps both failures if none works', async t => {
  const events: Array<{ status: string; error?: string }> = []
  const { client, file, target } = await fixture(t, (request, response) => {
    if (request.headers.range === 'bytes=0-0' && request.url === '/model') { response.end(data.subarray(0, 1)); return }
    response.writeHead(request.url === '/model' ? 502 : 503); response.end()
  })
  await assert.rejects(client.download({ ...file, mirrors: [file.url + '/mirror'] }, target, new AbortController().signal, () => {}, event => events.push(event)), error => error instanceof AggregateError && error.errors.length === 2 && /502/.test(error.message) && /503/.test(error.message))
  assert.equal(events.filter(event => event.status === 'failed').length, 2)
  assert.equal(await fileSize(target), 0)
})

test('a nonresponsive official endpoint is bounded by the short probe deadline', async t => {
  const { client, file, target } = await fixture(t, (request, response) => { if (request.url !== '/model') response.end(data) })
  const before = Date.now()
  await client.download({ ...file, mirrors: [file.url + '/mirror'] }, target, new AbortController().signal, () => {})
  assert.ok(Date.now() - before < 5000)
  assert.deepEqual(await readFile(target), data)
})
