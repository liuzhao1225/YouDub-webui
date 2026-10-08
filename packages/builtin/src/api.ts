import { type Context } from 'cordis'
import Busboy from 'busboy'
import type { Artifact, CreateTask, TaskView } from '@youdub/sdk'
import { AppError, requireId } from '@youdub/sdk'
import { readJson, type HttpRequest } from './http.js'
import './auth.js'
import './extensions.js'

export const name = 'youdub-api'
export const inject = ['http', 'auth', 'tasks', 'catalog', 'files', 'settings', 'extensions']
export function apply(ctx: Context) {
  const route = (method: string, path: string, handler: (request: HttpRequest) => Promise<void> | void) => ctx.effect(() => ctx.http.register(method, path, handler))
  const view = (task: TaskView) => ({ ...task, outputs: task.outputs.map(output => ({ ...output, url: `/api/v2/tasks/${task.id}/files/${encodeURIComponent(output.id)}` })) })
  route('GET', '/api/health', request => {
    ctx.tasks.assertReady()
    ctx.http.json(request, 200, { status: 'ready', api_version: 'v2' })
  })
  route('GET', '/api/v2/catalog', request => ctx.http.json(request, 200, ctx.catalog.describe()))
  route('GET', '/api/v2/workflows', request => ctx.http.json(request, 200, { items: ctx.catalog.describe().workflows }))
  const base = '/api/v2'
  route('GET', `${base}/runtime`, async request => ctx.http.json(request, 200, await ctx.settings.runtime()))
  route('GET', `${base}/settings`, async request => ctx.http.json(request, 200, await ctx.settings.read()))
  route('PATCH', `${base}/settings`, async request => {
    const patch = await readJson(request)
    ctx.http.json(request, 200, await ctx.settings.patch(patch))
  })
  route('POST', `${base}/tasks`, async request => {
    const contentType = request.raw.headers['content-type'] || ''
    let release: (() => void | Promise<void>) | undefined
    try {
      let input: CreateTask
      if (contentType.startsWith('multipart/form-data')) {
        const result = await upload(ctx, request)
        input = result.input; release = result.release
      } else {
        input = await readJson(request)
        if (Object.keys(input.inputs || {}).length || input.artifacts) throw new AppError('INVALID_INPUT', 'Upload files as named multipart inputs.', 422)
        input.inputs = {}; requireId(input.id)
        release = await ctx.files.reserve(input.id, true)
      }
      const task = await ctx.tasks.create(input)
      ctx.http.json(request, 201, view(task))
    } finally { await release?.() }
  })
  route('GET', `${base}/tasks`, async request => {
    const query = request.url.searchParams
    const limit = Number(query.get('limit') || 20), offset = Number(query.get('offset') || 0)
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0) throw new AppError('INVALID_CONFIG', 'Invalid pagination.', 422)
    const filters = { limit, offset, status: query.get('status') || undefined, active: query.has('active') ? query.get('active') === 'true' : undefined }
    const page = await ctx.tasks.list(filters)
    ctx.http.json(request, 200, { ...page, items: page.items.map(view) })
  })
  route('GET', `${base}/tasks/:id`, async request => ctx.http.json(request, 200, view(await ctx.tasks.get(request.params.id!))))
  for (const action of ['cancel', 'retry', 'rerun'] as const) route('POST', `${base}/tasks/:id/${action}`, async request => {
    const body = await readJson(request)
    const id = request.params.id!
    const current = await ctx.tasks.get(id)
    const task = action === 'rerun' ? await ctx.tasks.rerun(id, { id: body.id, config: body.config, workflowId: body.workflowId, acknowledgeExternalRisk: body.acknowledgeExternalRisk }) : await ctx.tasks[action](id, body.expectedAttempt ?? current.attempt)
    ctx.http.json(request, action === 'rerun' ? 201 : task.status === 'cancelling' ? 202 : 200, view(task))
  })
  route('DELETE', `${base}/tasks/:id`, async request => {
    const task = await ctx.tasks.get(request.params.id!)
    await ctx.tasks.delete(task.id, Number(request.url.searchParams.get('expectedAttempt') || task.attempt))
    ctx.http.json(request, 204)
  })
  route('GET', `${base}/tasks/:id/files/:output`, async request => {
    const id = request.params.id!, unlock = ctx.files.readLock(id)
    try {
      const task = await ctx.tasks.record(id)
      const output = task.outputs.find(item => item.id === request.params.output)
      const artifact = output && task.artifacts[output.artifact.id]
      if (!artifact) throw new AppError('OUTPUT_NOT_FOUND', 'Output not found.', 404)
      await ctx.http.file(request, await ctx.files.resolve(id, artifact), { mime: artifact.mimeType, name: artifact.name, download: request.url.searchParams.get('download') === 'true' })
    } finally { await unlock() }
  })
  route('GET', `${base}/tasks/:id/log`, async request => {
    const lines = Number(request.url.searchParams.get('lines') || 200)
    if (!Number.isInteger(lines) || lines < 1 || lines > 1000) throw new AppError('INVALID_CONFIG', 'Invalid log line count.', 422)
    await ctx.tasks.get(request.params.id!)
    const log = await ctx.files.readLog(request.params.id!, lines)
    request.response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }); request.response.end(log)
  })
  route('GET', '/api/v2/extensions', request => ctx.http.json(request, 200, ctx.extensions.list()))
  route('DELETE', '/api/v2/imports/:id', async request => {
    const id = request.params.id!, release = await ctx.files.reserve(id)
    try {
      try { await ctx.tasks.record(id); throw new AppError('TASK_EXISTS', 'This import already belongs to a task. Use the task action.', 409) }
      catch (error) { if ((error as { code?: string }).code !== 'TASK_NOT_FOUND') throw error }
      await ctx.files.remove(id)
      ctx.http.json(request, 204)
    } finally { await release() }
  })
  route('POST', '/api/v2/extensions/install', async request => ctx.http.json(request, 201, await ctx.extensions.install(await readJson(request))))
  route('PATCH', '/api/v2/extensions/:id', async request => ctx.http.json(request, 200, await ctx.extensions.setEnabled(request.params.id!, (await readJson(request)).enabled)))
  route('DELETE', '/api/v2/extensions/:id', async request => { await ctx.extensions.remove(request.params.id!); ctx.http.json(request, 204) })
  route('GET', '/api/v2/client-manifest', request => ctx.http.json(request, 200, ctx.extensions.clientManifest(Boolean(request.state.session))))
  route('GET', '/api/plugins/:packageId/:version/:asset*', async request => {
    const asset = await ctx.extensions.asset(request.params.packageId!, request.params.version!, request.params.asset!, Boolean(request.state.session))
    await ctx.http.file(request, asset.path, { mime: asset.mime })
  })
}

async function upload(ctx: Context, request: HttpRequest) {
  const artifacts: Record<string, Artifact> = {}, inputs: Record<string, { id: string; schemaId: string }> = {}
  let metadata: any, release: (() => void | Promise<void>) | undefined, reservation: Promise<void> | undefined, failure: unknown
  const jobs: Promise<void>[] = []
  const slots = new Set<string>()
  let parser: ReturnType<typeof Busboy>
  try { parser = Busboy({ headers: request.raw.headers, limits: { files: 16, fields: 8, fieldSize: 1024 * 1024, fileSize: 4 * 1024 * 1024 * 1024 } }) }
  catch (error) { throw new AppError('INVALID_MULTIPART', (error as Error).message, 400) }
  parser.on('field', (name, value, info) => {
    if (info.valueTruncated) { failure = new AppError('FILE_TOO_LARGE', 'Metadata too large.', 413); return }
    if (name !== 'request' || metadata) { failure = new AppError('INVALID_INPUT', 'Expected one request metadata field.', 422); return }
    try { metadata = JSON.parse(value) } catch { failure = new AppError('INVALID_JSON', 'Invalid request metadata.', 400) }
  })
  parser.on('file', (name, stream, info) => {
    stream.once('error', error => {
      failure ??= 'code' in error ? error : new AppError('INVALID_MULTIPART', error.message, 400)
      parser.destroy(error)
    })
    const job = (async () => {
      const id = metadata?.id
      requireId(id)
      const slot = name.startsWith('input.') ? name.slice(6) : ''
      if (!slot || slots.has(slot)) throw new AppError('INVALID_INPUT', 'Expected unique input.<name> file fields.', 422)
      slots.add(slot)
      reservation ??= ctx.files.reserve(id, true).then(dispose => { release = dispose })
      await reservation
      const workflowId = metadata?.workflowId
      if (!workflowId) throw new AppError('INVALID_CONFIG', 'Send request metadata before input files.', 422)
      const descriptor = ctx.catalog.workflow(workflowId).describe().inputs.find(item => item.name === slot)
      if (!descriptor) throw new AppError('INVALID_INPUT', `Unknown workflow input: ${slot}`, 422)
      stream.once('limit', () => { failure = new AppError('FILE_TOO_LARGE', 'Input exceeds upload limit.', 413) })
      const artifact = await ctx.files.upload(id, slot, info.filename, info.mimeType, stream, descriptor.maxBytes)
      artifacts[artifact.id] = artifact; inputs[slot] = { id: artifact.id, schemaId: artifact.schemaId }
    })().catch(error => { failure ??= error; parser.destroy(error); stream.resume() })
    jobs.push(job)
  })
  parser.on('filesLimit', () => { failure = new AppError('FILE_TOO_LARGE', 'Too many input files.', 413) })
  parser.on('fieldsLimit', () => { failure = new AppError('FILE_TOO_LARGE', 'Too many metadata fields.', 413) })
  try {
    await new Promise<void>((resolve, reject) => {
      parser.once('close', resolve)
      parser.once('error', error => reject(failure ?? new AppError('INVALID_MULTIPART', error instanceof Error ? error.message : String(error), 400)))
      request.raw.once('aborted', () => parser.destroy(new AppError('UPLOAD_INTERRUPTED', 'Upload interrupted.', 400)))
      request.raw.pipe(parser)
    })
    await Promise.all(jobs)
    if (failure) throw failure
    requireId(metadata?.id)
    if (!reservation) release = await ctx.files.reserve(metadata.id, true)
    return { release, input: { ...metadata, inputs, artifacts, sourceName: Object.values(artifacts)[0]?.name || metadata.workflowId } as CreateTask }
  } catch (error) { await Promise.all(jobs); await release?.(); throw error }
  finally { request.raw.unpipe(parser); request.raw.resume() }
}
