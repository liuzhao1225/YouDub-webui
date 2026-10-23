import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from 'cordis'
import { mkdtemp, writeFile, readFile, stat, rm, mkdir, symlink, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { type Artifact, type StepState, type TaskRecord } from '@youdub/sdk'
import Processes from '../src/process.js'
import Files from '../src/files.js'
import Tasks from '../src/tasks.js'
import { taskApi } from './helpers/task-api.js'
import { taskCover } from '../src/task-cover.js'

async function setup(t: any) {
  const root = await mkdtemp(join(tmpdir(), 'youdub-cover-')), ctx = new Context()
  let api!: ReturnType<typeof taskApi>
  const task = { id: randomUUID(), status: 'running', artifacts: {}, inputs: {}, outputs: [], steps: [], plan: { steps: [], outputs: [] }, externalRequests: {} } as unknown as TaskRecord
  const app = await ctx.plugin(async context => {
    context.reflect.provide('store', { async call(method: string) {
      if (method === 'store.get') return task
      if (method === 'store.list') return { items: [task], limit: 20, offset: 0, hasMore: false }
      throw new Error(`Unexpected method: ${method}`)
    } })
    context.reflect.provide('catalog', {})
    context.reflect.provide('settings', {})
    context.reflect.provide('extensions', {})
    await context.plugin(Processes)
    await context.plugin(Files, { root })
    await context.plugin(Tasks)
    await context.plugin({ inject: ['tasks', 'catalog', 'files', 'settings', 'store'], apply(scope) { api = taskApi(scope) } })
  })
  t.after(async () => { await app.dispose(); await rm(root, { recursive: true }) })
  // Cover requests are read-only; no workflow loop or real model is started.
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
    await ctx.youdubWorker.run({ command: process.env.FFMPEG_PATH || 'ffmpeg', args: ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=64x48:r=1:d=1', '-f', 'lavfi', '-i', 'color=c=blue:s=64x48:r=1:d=1', '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0', '-c:v', 'mpeg4', '-threads', '1', '-n', file] })
    return artifact('video.mp4', 'video/mp4', await readFile(file))
  }
  function nodeOutput(id: string, name: string, file: Artifact, status: StepState['status'] = 'completed') {
    task.plan.steps.push({ id, label: id, bindingKey: id, operation: 'test/v1', input: {}, outputs: [{ name, kind: 'artifact', schemaId: file.schemaId, required: true }] })
    const step: StepState = { id, label: id, status, invocationId: randomUUID(), progress: 1, message: null, startedAt: null, finishedAt: null, outputs: { [name]: { id: file.id, schemaId: file.schemaId } }, error: null }
    task.steps.push(step)
    return step
  }
  const get = (suffix = '/cover') => api.request(`/api/v2/tasks/${task.id}${suffix}`)
  return { ctx, transport: api.transport, request: api.request, task, root, artifact, video, nodeOutput, get }
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
  const response = await get(''), body = await response.json() as any
  assert.equal(response.status, 200, JSON.stringify(body))
  assert.deepEqual(body.cover, { url: `/api/youdub/file?path=${encodeURIComponent(`/api/v2/tasks/${task.id}/cover?artifact=${encodeURIComponent(source.id)}`)}` })
  assert.equal(body.allowedActions.includes('approve'), false)
  assert.equal(body.allowedActions.includes('correct'), false)
  source.name = 'speech.mp3'
  assert.equal(taskCover(task), undefined)
  assert.equal('cover' in await (await get('')).json(), false)
  assert.equal((await get()).status, 404)
})

test('downloaded node videos expose a first frame before downstream nodes finish', async t => {
  const { task, request, video, nodeOutput, get } = await setup(t)
  assert.equal('cover' in await (await get('')).json(), false)
  const source = await video()
  nodeOutput('download', 'video', source)
  assert.equal(task.status, 'running')
  assert.deepEqual(task.outputs, [])
  const body = await (await get('')).json() as any
  const expected = { url: `/api/youdub/file?path=${encodeURIComponent(`/api/v2/tasks/${task.id}/cover?artifact=${encodeURIComponent(source.id)}`)}` }
  assert.deepEqual(body.cover, expected)
  const list = await request('/api/v2/tasks')
  assert.deepEqual((await list.json() as any).items[0].cover, expected)
  const response = await get(`/cover?artifact=${source.id}`)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-type'), 'image/jpeg')
  const bytes = new Uint8Array(await response.arrayBuffer())
  assert.deepEqual([...bytes.slice(0, 2)], [0xff, 0xd8])
})

test('current node covers and workflow cover declarations update URLs without selecting historical artifacts', async t => {
  const { task, artifact, nodeOutput, get } = await setup(t)
  const source = await artifact('source.mp4', 'video/mp4')
  task.inputs.video = source
  const first = await artifact('first.png', 'image/png', Buffer.from('first'))
  const second = await artifact('second.png', 'image/png', Buffer.from('second'))
  const step = nodeOutput('preview', 'thumbnail', first, 'awaiting_review')
  const initial = await (await get('')).json() as any
  assert.equal(taskCover(task), first)
  step.outputs.thumbnail = { id: second.id, schemaId: second.schemaId }
  const corrected = await (await get('')).json() as any
  assert.notEqual(corrected.cover.url, initial.cover.url)
  assert.equal(corrected.cover.url, `/api/youdub/file?path=${encodeURIComponent(`/api/v2/tasks/${task.id}/cover?artifact=${second.id}`)}`)
  assert.equal(await (await get(`/cover?artifact=${second.id}`)).text(), 'second')

  // An output can be declared as the workflow cover under a different node port.
  step.outputs = { image: { id: second.id, schemaId: second.schemaId } }
  task.plan.steps[0]!.outputs[0]!.name = 'image'
  task.plan.outputs = [{ id: 'cover', label: 'Cover', role: 'cover', source: { stepId: step.id, output: 'image' }, required: true }]
  assert.equal(taskCover(task), second)
  // Invalidating a node clears its current outputs but retains its files/history.
  step.outputs = {}; step.status = 'pending'
  step.resultRevisions = [{ revision: 1, parentRevision: null, source: 'computed', actionId: null, outputs: { image: { id: first.id, schemaId: first.schemaId } }, createdAt: new Date().toISOString() }]
  assert.equal(taskCover(task), source)
  task.inputs = {}
  assert.equal(taskCover(task), undefined)
  assert.equal('cover' in await (await get('')).json(), false)
})

test('an unavailable node cover reports its error without using an available video instead', async t => {
  const { ctx, task, artifact, nodeOutput, get } = await setup(t)
  const image = await artifact('cover.png', 'image/png')
  task.inputs.video = await artifact('source.mp4', 'video/mp4')
  nodeOutput('preview', 'cover', image)
  await rm(join(ctx.files.taskRoot(task.id), image.path))
  const generation = t.mock.method(ctx.youdubWorker, 'run', () => { throw new Error('The declared cover must remain selected') })
  const response = await get()
  assert.equal(response.status, 500)
  assert.equal(generation.mock.calls.length, 0)
})

test('registered cover images are served byte-for-byte through Harness', async t => {
  const { ctx, task, artifact, get } = await setup(t)
  const image = await artifact('cover.png', 'image/png', Buffer.from([137, 80, 78, 71]))
  task.inputs.cover = image
  t.mock.method(ctx.youdubWorker, 'run', () => { throw new Error('An image must not invoke FFmpeg') })
  const response = await get()
  assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'image/png')
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), Buffer.from([137, 80, 78, 71]))
})

test('source first frame is decoded once for concurrent requests and reused from disk', async t => {
  const { ctx, task, video } = await setup(t)
  const source = await video(), run = ctx.youdubWorker.run.bind(ctx.youdubWorker)
  const calls = t.mock.method(ctx.youdubWorker, 'run', run)
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

test('cover requests hold a read lock during generation and file transfer', async t => {
  const { ctx, transport, task, video, get } = await setup(t)
  task.inputs.video = await video()
  let generationEntered!: () => void, releaseGeneration!: () => void, transferEntered!: () => void, releaseTransfer!: () => void
  const generation = new Promise<void>(resolve => { generationEntered = resolve }), generationGate = new Promise<void>(resolve => { releaseGeneration = resolve })
  const transfer = new Promise<void>(resolve => { transferEntered = resolve }), transferGate = new Promise<void>(resolve => { releaseTransfer = resolve })
  const run = ctx.youdubWorker.run.bind(ctx.youdubWorker), file = transport.file.bind(transport)
  const readLock = ctx.files.readLock.bind(ctx.files)
  let unlocked!: () => void
  const lockReleased = new Promise<void>(resolve => { unlocked = resolve })
  t.mock.method(ctx.files, 'readLock', (id: string) => { const release = readLock(id); return async () => { await release(); unlocked() } })
  t.mock.method(ctx.youdubWorker, 'run', async (request: Parameters<typeof run>[0]) => { generationEntered(); await generationGate; return run(request) })
  t.mock.method(transport, 'file', async (...args: Parameters<typeof file>) => { transferEntered(); await transferGate; return file(...args) })
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
  await symlink(root, directory, process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(ctx.files.cover(task.id, source), { code: 'INVALID_COVER_PATH' })
  await rm(directory); await mkdir(directory)
  await t.test('redirected cache file is rejected', async t => {
    try { await symlink(outside, join(directory, createHash('sha256').update(source.id).digest('hex') + '.jpg')) }
    catch (error: any) { if (process.platform === 'win32' && error.code === 'EPERM') { t.skip('File symlinks require Windows Developer Mode or administrator privileges.'); return }; throw error }
    await assert.rejects(ctx.files.cover(task.id, source), { code: 'INVALID_COVER_CACHE' })
  })
})
