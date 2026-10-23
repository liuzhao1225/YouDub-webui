// YouDub business routes retained from the frozen source branch; transport is Harness Connection.
import { type Context } from 'cordis'
import Busboy from 'busboy'
import type { Artifact, CreateTask, TaskView, TaskSummary } from '@youdub/sdk'
import { AppError, requireId } from '@youdub/sdk'
import { readJson, fileURL } from './transport.mjs'
type HttpRequest = any
import { taskCover } from '../../../../packages/builtin/src/task-cover.ts'
import { nodeTypes, inspectGraph } from '../../../../packages/builtin/src/workflow-graph.ts'
import { parseWorkflowDocument } from '../../../../packages/builtin/src/workflow-document.ts'
import { workflowTemplates } from '../../../../packages/builtin/src/workflow-templates.ts'
import { migrateLegacyDefaults, readDefaultsMigration, type DefaultsMigration } from '../../../../packages/builtin/src/legacy-defaults-migration.ts'

export function registerTaskRoutes(ctx: any, http: any, config: { version: string }) {
  if (!config?.version) throw new Error('The API requires the application version from its composition.')
  const currentVersion = config.version
  const route = (method: string, path: string, handler: (request: HttpRequest) => Promise<void> | void) => ctx.effect(() => http.register(method, path, handler))
  const view = <T extends TaskView | TaskSummary>(task: T) => ({ ...task, ...(task.cover ? { cover: { url: fileURL(`/api/v2/tasks/${task.id}/cover?artifact=${encodeURIComponent(task.cover.artifactId!)}`) } } : {}), outputs: task.outputs.map(output => ({ ...output, url: fileURL(`/api/v2/tasks/${task.id}/files/${encodeURIComponent(output.id)}`) })) })
  route('GET', '/api/health', request => {
    ctx.tasks.assertReady()
    http.json(request, 200, { status: 'ready', api_version: 'v2' })
  })
  route('GET', '/api/v2/catalog', async request => { await ctx.catalog.refresh(); http.json(request, 200, ctx.catalog.describe()) })
  route('GET', '/api/v2/workflows', request => http.json(request, 200, { items: ctx.catalog.describe().workflows }))
  const base = '/api/v2'
  const templates = async () => workflowTemplates(ctx.catalog, await ctx.settings.read())
  let migrationFailure: DefaultsMigration | undefined
  const migrateDefaults = async () => {
    try {
      const result = await ctx.settings.locked(() => migrateLegacyDefaults(ctx.store, ctx.catalog))
      migrationFailure = undefined
      return result
    } catch (error) {
      migrationFailure = { version: 1, status: 'blocked', diagnostics: [{ code: error instanceof AppError ? error.code : 'DEFAULTS_MIGRATION_FAILED', message: error instanceof Error ? error.message : String(error) }] }
      throw error
    }
  }
  let initialization: Promise<void> | undefined
  ctx.on('app/ready', () => {
    initialization ??= migrateDefaults().then(() => {}, error => { ctx.logger.error(error) })
  })
  const migrationStatus = async () => { await initialization; return migrationFailure ?? await readDefaultsMigration(ctx.store) }
  route('POST', `${base}/workflow-documents/migrate-defaults`, async request => {
    await initialization
    http.json(request, 200, await migrateDefaults())
  })
  route('GET', `${base}/node-types`, request => http.json(request, 200, { items: nodeTypes(ctx.catalog) }))
  route('GET', `${base}/workflow-documents`, async request => {
    const limit = Number(request.url.searchParams.get('limit') ?? 100), offset = Number(request.url.searchParams.get('offset') ?? 0)
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0) throw new AppError('INVALID_CONFIG', 'Invalid workflow pagination.', 422)
    const legacyDefaultsMigration = await migrationStatus()
    const page = await ctx.store.call('store.workflow_list', { limit, offset })
    http.json(request, 200, { ...page, legacyDefaultsMigration, items: [...(offset === 0 ? await templates() : []), ...page.items.map((item: any) => ({ ...item, origin: 'user' }))] })
  })
  route('POST', `${base}/workflow-documents`, async request => {
    const document = parseWorkflowDocument((await readJson(request)).document)
    if ((await templates()).some(item => item.id === document.id)) throw new AppError('READ_ONLY_WORKFLOW', 'Save a template with a new ID.', 409)
    const saved = await ctx.store.call('store.workflow_create', { document })
    http.json(request, 201, { ...saved, origin: 'user' })
  })
  route('POST', `${base}/workflow-documents/validate`, async request => {
    const body = await readJson(request)
    const result = inspectGraph(body.document, ctx.catalog, body.nodeRuntimeInputs === undefined ? {} : body.nodeRuntimeInputs)
    http.json(request, 200, { valid: !result.diagnostics.length, diagnostics: result.diagnostics, requiredProviders: result.document.nodes.map(node => ({ providerId: node.provider.id, model: node.provider.model })) })
  })
  route('GET', `${base}/workflow-documents/:id`, async request => {
    const builtin = (await templates()).find(item => item.id === request.params.id)
    if (builtin) { http.json(request, 200, builtin); return }
    const saved = await ctx.store.call('store.workflow_get', { id: request.params.id })
    if (!saved) throw new AppError('WORKFLOW_NOT_FOUND', 'Workflow not found.', 404)
    http.json(request, 200, { ...saved, origin: 'user' })
  })
  route('PUT', `${base}/workflow-documents/:id`, async request => {
    if ((await templates()).some(item => item.id === request.params.id)) throw new AppError('READ_ONLY_WORKFLOW', 'Save a template as a copy.', 409)
    const body = await readJson(request), document = parseWorkflowDocument(body.document)
    if (document.id !== request.params.id) throw new AppError('INVALID_WORKFLOW', 'Document ID does not match the route.', 422)
    http.json(request, 200, { ...await ctx.store.call('store.workflow_update', { id: document.id, document, expectedRevision: body.expectedRevision }), origin: 'user' })
  })
  route('DELETE', `${base}/workflow-documents/:id`, async request => {
    if ((await templates()).some(item => item.id === request.params.id)) throw new AppError('READ_ONLY_WORKFLOW', 'Built-in templates cannot be deleted.', 409)
    await ctx.store.call('store.workflow_delete', { id: request.params.id, expectedRevision: Number(request.url.searchParams.get('expectedRevision')) })
    http.json(request, 204)
  })
  route('GET', `${base}/runtime`, async request => http.json(request, 200, await ctx.settings.runtime()))
  route('GET', `${base}/settings`, async request => http.json(request, 200, await ctx.settings.read()))
  route('POST', `${base}/settings/test-connection`, async request => {
    http.json(request, 200, await ctx.settings.testConnection(await readJson(request)))
  })
  route('PATCH', `${base}/settings`, async request => {
    const patch = await readJson(request)
    http.json(request, 200, await ctx.settings.patch(patch))
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
      http.json(request, 201, view(task))
    } finally { await release?.() }
  })
  route('GET', `${base}/tasks`, async request => {
    const query = request.url.searchParams
    const limit = Number(query.get('limit') || 20), offset = Number(query.get('offset') || 0)
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0) throw new AppError('INVALID_CONFIG', 'Invalid pagination.', 422)
    const filters = { limit, offset, status: query.get('status') || undefined, active: query.has('active') ? query.get('active') === 'true' : undefined }
    const page = await ctx.tasks.list(filters)
    http.json(request, 200, { ...page, items: page.items.map(view) })
  })
  route('GET', `${base}/tasks/:id`, async request => http.json(request, 200, view(await ctx.tasks.get(request.params.id!))))
  for (const action of ['cancel', 'retry', 'rerun'] as const) route('POST', `${base}/tasks/:id/${action}`, async request => {
    const body = await readJson(request)
    const id = request.params.id!
    const current = await ctx.tasks.get(id)
    const task = action === 'rerun' ? await ctx.tasks.rerun(id, { ...body, config: body.config ?? {} }) : action === 'cancel' ? await ctx.tasks.cancel(id, body.expectedAttempt ?? current.attempt, body.expectedTaskRevision) : await ctx.tasks.retry(id, body.expectedAttempt ?? current.attempt)
    http.json(request, action === 'rerun' ? 201 : task.status === 'cancelling' ? 202 : 200, view(task))
  })
  route('GET', `${base}/tasks/:id/nodes/:nodeId`, async request => http.json(request, 200, await ctx.tasks.node(request.params.id!, request.params.nodeId!)))
  route('GET', `${base}/tasks/:id/nodes/:nodeId/results/:revision`, async request => {
    const revision = Number(request.params.revision)
    if (!Number.isInteger(revision) || revision < 1) throw new AppError('INVALID_REVISION', 'Result revision must be a positive integer.', 422)
    http.json(request, 200, await ctx.tasks.node(request.params.id!, request.params.nodeId!, revision))
  })
  route('POST', `${base}/tasks/:id/nodes/:nodeId/corrections`, async request => http.json(request, 200, await ctx.tasks.correct(request.params.id!, request.params.nodeId!, await readJson(request))))
  route('POST', `${base}/tasks/:id/nodes/:nodeId/approve`, async request => http.json(request, 200, await ctx.tasks.approve(request.params.id!, request.params.nodeId!, await readJson(request))))
  route('GET', `${base}/tasks/:id/actions/:actionId`, async request => {
    const receipt = await ctx.tasks.action(request.params.id!, request.params.actionId!)
    if (!receipt) throw new AppError('ACTION_NOT_FOUND', 'Action has not been recorded.', 404)
    http.json(request, 200, receipt)
  })
  route('POST', `${base}/tasks/:id/rerun-preview`, async request => http.json(request, 200, await ctx.tasks.rerunPreview(request.params.id!, { config: {}, ...await readJson(request) })))
  route('GET', `${base}/tasks/:id/artifacts/:artifactId`, async request => {
    const id = request.params.id!, unlock = ctx.files.readLock(id)
    request.releaseReadLock = unlock
    try {
      const task = await ctx.tasks.record(id), artifact = Object.hasOwn(task.artifacts, request.params.artifactId!) ? task.artifacts[request.params.artifactId!] : undefined
      if (!artifact) throw new AppError('ARTIFACT_NOT_FOUND', 'Artifact is not owned by this task.', 404)
      await http.file(request, await ctx.files.resolve(id, artifact), { mime: artifact.mimeType, name: artifact.name, download: request.url.searchParams.get('download') === 'true' })
    } finally { if (!request.streamingRelease) await unlock() }
  })
  route('DELETE', `${base}/tasks/:id`, async request => {
    const task = await ctx.tasks.get(request.params.id!)
    await ctx.tasks.delete(task.id, Number(request.url.searchParams.get('expectedAttempt') || task.attempt))
    http.json(request, 204)
  })
  route('GET', `${base}/tasks/:id/cover`, async request => {
    const id = request.params.id!, unlock = ctx.files.readLock(id)
    request.releaseReadLock = unlock
    try {
      const artifact = taskCover(await ctx.tasks.record(id))
      if (!artifact) throw new AppError('COVER_NOT_FOUND', 'Task has no cover image or video.', 404)
      const cover = await ctx.files.cover(id, artifact)
      await http.file(request, cover.path, { mime: cover.mimeType })
    } finally { if (!request.streamingRelease) await unlock() }
  })
  route('GET', `${base}/tasks/:id/files/:output`, async request => {
    const id = request.params.id!, unlock = ctx.files.readLock(id)
    request.releaseReadLock = unlock
    try {
      const task = await ctx.tasks.record(id)
      const output = task.outputs.find(item => item.id === request.params.output)
      const artifact = output && task.artifacts[output.artifact.id]
      if (!artifact) throw new AppError('OUTPUT_NOT_FOUND', 'Output not found.', 404)
      await http.file(request, await ctx.files.resolve(id, artifact), { mime: artifact.mimeType, name: artifact.name, download: request.url.searchParams.get('download') === 'true' })
    } finally { if (!request.streamingRelease) await unlock() }
  })
  route('GET', `${base}/tasks/:id/log`, async request => {
    const lines = Number(request.url.searchParams.get('lines') || 200)
    if (!Number.isInteger(lines) || lines < 1 || lines > 1000) throw new AppError('INVALID_CONFIG', 'Invalid log line count.', 422)
    await ctx.tasks.get(request.params.id!)
    const log = await ctx.files.readLog(request.params.id!, lines)
    request.response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }); request.response.end(log)
  })
  route('DELETE', '/api/v2/imports/:id', async request => {
    const id = request.params.id!, release = await ctx.files.reserve(id)
    try {
      try { await ctx.tasks.record(id); throw new AppError('TASK_EXISTS', 'This import already belongs to a task. Use the task action.', 409) }
      catch (error) { if ((error as { code?: string }).code !== 'TASK_NOT_FOUND') throw error }
      await ctx.files.remove(id)
      http.json(request, 204)
    } finally { await release() }
  })

}

async function upload(ctx: any, request: HttpRequest) {
  const artifacts: Record<string, Artifact> = {}, inputs: Record<string, { id: string; schemaId: string }> = {}
  let metadata: any, release: (() => void | Promise<void>) | undefined, reservation: Promise<void> | undefined, failure: unknown
  const jobs: Promise<void>[] = []
  const slots = new Set<string>()
  let parser: ReturnType<typeof Busboy>
  try { parser = Busboy({ headers: request.raw.headers, defParamCharset: 'utf8', limits: { fields: 1, fieldSize: Infinity } }) }
  catch (error) { throw new AppError('INVALID_MULTIPART', (error as Error).message, 400) }
  parser.on('field', (name, value) => {
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
      const workflow = ctx.catalog.workflow(workflowId)
      const graph = 'graph' in workflow ? parseWorkflowDocument(metadata.graphDocument) : undefined
      const descriptor = graph ? graph.inputs.find(item => item.id === slot) : workflow.describe().inputs.find(item => item.name === slot)
      if (!descriptor) throw new AppError('INVALID_INPUT', `Unknown workflow input: ${slot}`, 422)
      if (graph && !descriptor.acceptedMimeTypes.some(mime => mime === info.mimeType || (mime.endsWith('/*') && info.mimeType.startsWith(mime.slice(0, -1))))) throw new AppError('INVALID_INPUT', `Unsupported MIME type for ${slot}: ${info.mimeType}`, 422)
      const artifact = await ctx.files.upload(id, slot, info.filename, info.mimeType, stream)
      if (graph) artifact.schemaId = graph.inputs.find(item => item.id === slot)!.schemaId
      artifacts[artifact.id] = artifact; inputs[slot] = { id: artifact.id, schemaId: artifact.schemaId }
    })().catch(error => { failure ??= error; parser.destroy(error); stream.resume() })
    jobs.push(job)
  })
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
    const firstInput = inputs[[...slots][0]!]
    const firstArtifact = firstInput && artifacts[firstInput.id]
    return { release, input: { ...metadata, inputs, artifacts, sourceName: firstArtifact?.name || metadata.sourceName || metadata.workflowId } as CreateTask }
  } catch (error) { await Promise.all(jobs); await release?.(); throw error }
  finally { request.raw.unpipe(parser); request.raw.resume() }
}
