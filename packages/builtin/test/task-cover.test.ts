import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from 'cordis'
import { mkdtemp, writeFile, readFile, stat, rm, mkdir, symlink, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { type Artifact, type TaskRecord } from '@youdub/sdk'
import Processes from '../src/process.js'
import Files from '../src/files.js'
import Tasks from '../src/tasks.js'
import Http from '../src/http.js'
import Auth from '../src/auth.js'
import * as Api from '../src/api.js'
import { taskCover } from '../src/task-cover.js'

async function setup(t: any) {
  const root = await mkdtemp(join(tmpdir(), 'youdub-cover-')), ctx = new Context()
  const task = { id: randomUUID(), status: 'running', artifacts: {}, inputs: {}, outputs: [], externalRequests: {} } as unknown as TaskRecord
  const app = await ctx.plugin(async context => {
    context.reflect.provide('store', { async call(method: string) {
      if (method === 'store.get') return task
      if (method === 'store.list') return { items: [task], limit: 20, offset: 0, hasMore: false }
      if (method === 'auth.validate') return { cookieName: 'cover_test', sessionTtlSeconds: 300, cookieSecure: false, cookieSameSite: 'lax', credentialVersion: 'v1' }
      if (method === 'auth.get_session') return { expires_at: '2100-01-01T00:00:00+00:00', credential_version: 'v1' }
      throw new Error(`Unexpected method: ${method}`)
    } })
    context.reflect.provide('catalog', {})
    context.reflect.provide('settings', {})
    context.reflect.provide('extensions', {})
    await context.plugin(Processes)
    await context.plugin(Files, { root })
    await context.plugin(Tasks)
    await context.plugin(Http, { host: '127.0.0.1', port: 0 })
    await context.plugin(Auth)
    await context.plugin(Api)
  })
  t.after(async () => { await app.dispose(); await rm(root, { recursive: true }) })
  // Cover requests are read-only; no workflow loop or real model is started.
  ctx.http.ready = true
  const release = await ctx.files.reserve(task.id, true); await release()
  async function artifact(name: string, mimeType: string, bytes: Uint8Array = Buffer.from('image')) {
    const file = join(ctx.files.taskRoot(task.id), name)
    await writeFile(file, bytes)
    const result: Artifact = { id: randomUUID(), path: relative(ctx.files.taskRoot(task.id), file), name, mimeType, schemaId: 'file/v1', size: (await stat(file)).size, metadata: {}, invocationId: 'input' }
    task.artifacts[result.id] = result
    return result
  }
  async function video() {
    const file = join(ctx.files.taskRoot(task.id), 'source.mp4')
    await ctx.process.run({ command: process.env.FFMPEG_PATH || 'ffmpeg', args: ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=64x48:r=1:d=1', '-f', 'lavfi', '-i', 'color=c=blue:s=64x48:r=1:d=1', '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0', '-c:v', 'mpeg4', '-threads', '1', '-n', file] })
    return artifact('video.mp4', 'video/mp4', await readFile(file))
  }
  const get = (suffix = '/cover', authenticated = true) => fetch(`${ctx.http.address}/api/v2/tasks/${task.id}${suffix}`, { headers: authenticated ? { Cookie: 'cover_test=test' } : {}, signal: AbortSignal.timeout(5000) })
  return { ctx, task, root, artifact, video, get }
}

test('cover selection prioritizes declared pictures, then source video, then video output', async t => {
  const { task, artifact } = await setup(t)
  const source = await artifact('input.mp4', 'video/mp4'), result = await artifact('result.mp4', 'video/mp4'), picture = await artifact('poster.png', 'image/png'), unrelated = await artifact('plot.png', 'image/png')
  task.outputs = [{ id: 'plot', role: 'plot', label: 'Plot', artifact: unrelated }, { id: 'result', role: 'video', label: 'Result', artifact: result }]
  assert.equal(taskCover(task), result)
  task.inputs.video = source
  assert.equal(taskCover(task), source)
  task.inputs.thumbnail = picture
  assert.equal(taskCover(task), picture)
  task.outputs.push({ id: 'picture', role: 'cover', label: 'Cover', artifact: unrelated })
  assert.equal(taskCover(task), unrelated)
})

test('legacy video inputs remain preferred over outputs without advertising audio as a cover', async t => {
  const { task, artifact, get } = await setup(t)
  task.legacy = true
  const source = await artifact('speech.MP4', 'application/octet-stream')
  source.id = `legacy:${task.id}:input`; task.artifacts[source.id] = source
  task.inputs.video = source
  assert.equal(taskCover(task), source)
  assert.deepEqual((await (await get('')).json() as any).cover, { url: `/api/v2/tasks/${task.id}/cover` })
  source.name = 'speech.mp3'
  assert.equal(taskCover(task), undefined)
  assert.equal('cover' in await (await get('')).json(), false)
  assert.equal((await get()).status, 404)
})

test('registered cover images are served byte-for-byte and require authentication', async t => {
  const { ctx, task, artifact, get } = await setup(t)
  const image = await artifact('cover.png', 'image/png', Buffer.from([137, 80, 78, 71]))
  task.inputs.cover = image
  t.mock.method(ctx.process, 'run', () => { throw new Error('An image must not invoke FFmpeg') })
  assert.equal((await get('/cover', false)).status, 401)
  const response = await get()
  assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'image/png')
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), Buffer.from([137, 80, 78, 71]))
})

test('source first frame is decoded once for concurrent requests and reused from disk', async t => {
  const { ctx, task, video } = await setup(t)
  const source = await video(), run = ctx.process.run.bind(ctx.process)
  const calls = t.mock.method(ctx.process, 'run', run)
  const covers = await Promise.all(Array.from({ length: 4 }, () => ctx.files.cover(task.id, source)))
  assert.equal(calls.mock.calls.length, 1)
  assert.ok(covers.every(value => value.path === covers[0]!.path && value.mimeType === 'image/jpeg'))
  assert.deepEqual(await ctx.files.cover(task.id, source), covers[0])
  assert.equal(calls.mock.calls.length, 1)
  const pixels = join(ctx.files.taskRoot(task.id), 'pixels.rgb')
  await run({ command: process.env.FFMPEG_PATH || 'ffmpeg', args: ['-nostdin', '-v', 'error', '-i', covers[0]!.path, '-frames:v', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-n', pixels] })
  const pixel = await readFile(pixels)
  assert.ok(pixel[0]! > 200 && pixel[1]! < 40 && pixel[2]! < 40, 'Cover must show the first red frame, not the later blue frame')
})

test('cover requests hold a read lock during generation and HTTP file transfer', async t => {
  const { ctx, task, video, get } = await setup(t)
  task.inputs.video = await video()
  let generationEntered!: () => void, releaseGeneration!: () => void, transferEntered!: () => void, releaseTransfer!: () => void
  const generation = new Promise<void>(resolve => { generationEntered = resolve }), generationGate = new Promise<void>(resolve => { releaseGeneration = resolve })
  const transfer = new Promise<void>(resolve => { transferEntered = resolve }), transferGate = new Promise<void>(resolve => { releaseTransfer = resolve })
  const run = ctx.process.run.bind(ctx.process), file = ctx.http.file.bind(ctx.http)
  const readLock = ctx.files.readLock.bind(ctx.files)
  let unlocked!: () => void
  const lockReleased = new Promise<void>(resolve => { unlocked = resolve })
  t.mock.method(ctx.files, 'readLock', (id: string) => { const release = readLock(id); return async () => { await release(); unlocked() } })
  t.mock.method(ctx.process, 'run', async (request: Parameters<typeof run>[0]) => { generationEntered(); await generationGate; return run(request) })
  t.mock.method(ctx.http, 'file', async (...args: Parameters<typeof file>) => { transferEntered(); await transferGate; return file(...args) })
  const response = get()
  await generation
  await assert.rejects(ctx.files.reserve(task.id), { code: 'TASK_BUSY' })
  releaseGeneration(); await transfer
  await assert.rejects(ctx.files.reserve(task.id), { code: 'TASK_BUSY' })
  releaseTransfer(); assert.equal((await response).status, 200); await (await response).arrayBuffer()
  await lockReleased
  const release = await ctx.files.reserve(task.id); await release()
})

test('invalid media fails visibly without caching partial output or choosing another cover', async t => {
  const { ctx, task, artifact, get } = await setup(t)
  const source = await artifact('broken.mp4', 'video/mp4')
  task.inputs.video = source
  await assert.rejects(ctx.files.cover(task.id, source), (error: any) => error.code === 'PROCESS_EXITED' && error.message.includes(task.id) && error.message.includes(source.id))
  assert.deepEqual(await readdir(join(ctx.files.taskRoot(task.id), 'covers')), [])
  const response = await get()
  assert.equal(response.status, 500); assert.equal((await response.json() as any).error.code, 'PROCESS_EXITED')
  const release = await ctx.files.reserve(task.id); await release()
})

test('cover source and cache cannot escape the task directory through paths or symlinks', async t => {
  const { ctx, task, root, artifact } = await setup(t)
  const source = await artifact('video.mp4', 'video/mp4')
  const outside = join(root, 'outside.jpg'); await writeFile(outside, 'image')
  await assert.rejects(ctx.files.cover(task.id, { ...source, mimeType: 'image/jpeg', path: outside }), { code: 'OUTPUT_NOT_FOUND' })
  const directory = join(ctx.files.taskRoot(task.id), 'covers')
  await symlink(root, directory)
  await assert.rejects(ctx.files.cover(task.id, source), { code: 'INVALID_COVER_PATH' })
  await rm(directory); await mkdir(directory)
  await symlink(outside, join(directory, createHash('sha256').update(source.id).digest('hex') + '.jpg'))
  await assert.rejects(ctx.files.cover(task.id, source), { code: 'INVALID_COVER_CACHE' })
})
