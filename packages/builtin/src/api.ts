import { type Context } from 'cordis'
import Busboy from 'busboy'
import type { Artifact, CreateTask, TaskView, StepState } from '@youdub/sdk'
import { requireId } from '@youdub/sdk'
import { HttpError, readJson, type HttpRequest } from './http.js'
import './auth.js'
import './extensions.js'

export const name = 'youdub-api'
export const inject = ['http', 'auth', 'tasks', 'catalog', 'files', 'settings', 'extensions', 'store']
export function apply(ctx: Context, config: { defaultWorkflowId?: string } = {}) {
  const route = (method: string, path: string, handler: (request: HttpRequest) => Promise<void> | void) => ctx.effect(() => ctx.http.register(method, path, handler))
  const view = async (task: TaskView) => {
    const record = await ctx.tasks.record(task.id)
    return { ...task, outputs: record.outputs.map(output => {
      const file = record.artifacts[output.artifact.id]
      if (!file) throw new Error(`Output artifact missing: ${output.artifact.id}`)
      return { id: output.id, label: output.label, role: output.role, name: file.name, mimeType: file.mimeType, size: file.size, url: `/api/v2/tasks/${task.id}/files/${encodeURIComponent(output.id)}` }
    }) }
  }
  const legacy = async (task: TaskView) => {
    if (!task.legacy && task.workflowId !== (config.defaultWorkflowId || 'youdub.localize')) throw new HttpError(409, 'CONTRACT_UNSUPPORTED', 'This workflow is only available through API v2.')
    const record = await ctx.tasks.record(task.id)
    if (record.legacy && record.rawSnapshot) {
      const raw = record.rawSnapshot, state = JSON.parse(raw.stage_context_json || '{}')
      return { id: task.id, attempt: task.attempt, source_name: raw.source_name, source_size_bytes: raw.source_size_bytes, source_duration_ms: raw.source_duration_ms, status: task.status, current_stage: raw.current_stage, stage_progress: raw.stage_progress, wait_reason: raw.wait_reason, message: task.message, error: task.error, external_operation: state.external_operation, allowed_actions: task.allowedActions, created_at: task.createdAt, updated_at: task.updatedAt, started_at: task.startedAt, finished_at: task.finishedAt, config: task.config, pipeline_version: state.pipeline_version, resolved_connections: state.resolved_connections, outputs: JSON.parse(raw.outputs_json || '{}') }
    }
    const projected = await view(task)
    const currentStep = task.steps.find((step: StepState) => ['running', 'waiting', 'failed', 'cancelled'].includes(step.status))
    const originalStage = currentStep?.id || (task.status === 'succeeded' ? 'done' : 'prepare')
    const stage = ({ recognize: 'asr', reference: 'tts', synthesize: 'tts', align: 'export' } as Record<string, string>)[originalStage] || originalStage
    const outputs = Object.fromEntries(projected.outputs.map(file => [file.role || file.id, { url: file.url, file_name: file.name, mime_type: file.mimeType, size_bytes: file.size, duration_ms: null, timeline: null }]))
    return { id: task.id, attempt: task.attempt, source_name: task.sourceName, source_size_bytes: record.inputs.video ? record.artifacts[record.inputs.video.id]?.size ?? 0 : 0, source_duration_ms: task.sourceDurationMs ?? null, status: task.status, current_stage: stage, stage_progress: currentStep?.progress ?? null, wait_reason: task.status === 'waiting' ? 'remote_result' : null, message: task.message, error: task.error ? { ...task.error, field: task.error.field ?? null, stage: stage === 'done' ? null : stage, action: 'none' } : null, external_operation: { state: task.mayStillRun ? 'unknown' : 'none', may_still_run: task.mayStillRun }, allowed_actions: task.allowedActions, created_at: task.createdAt, updated_at: task.updatedAt, started_at: task.startedAt, finished_at: task.finishedAt, config: task.config, pipeline_version: 'cordis-v1', resolved_connections: task.connections, outputs }
  }
  route('GET', '/api/health', request => ctx.http.json(request, ctx.http.ready ? 200 : 503, { status: ctx.http.ready ? 'ready' : 'starting', api_version: 'v2' }))
  route('GET', '/api/v2/catalog', request => ctx.http.json(request, 200, ctx.catalog.describe()))
  route('GET', '/api/v2/workflows', request => ctx.http.json(request, 200, { items: ctx.catalog.describe().workflows }))
  for (const version of ['v1', 'v2']) {
    const base = `/api/${version}`
    const project = version === 'v1' ? legacy : view
    const settingsView = (settings: any) => version === 'v2' ? settings : { defaults: settings.defaults, connections: settings.connections, ui_language: settings.ui_language }
    route('GET', `${base}/runtime`, async request => ctx.http.json(request, 200, await ctx.settings.runtime()))
    route('GET', `${base}/settings`, async request => ctx.http.json(request, 200, settingsView(await ctx.settings.read())))
    route('PATCH', `${base}/settings`, async request => {
      const patch = await readJson(request)
      if (version === 'v1' && patch && Object.hasOwn(patch, 'plugin')) throw new HttpError(422, 'CONTRACT_UNSUPPORTED', 'Plugin settings require API v2.')
      ctx.http.json(request, 200, settingsView(await ctx.settings.patch(patch)))
    })
    route('POST', `${base}/tasks`, async request => {
      const contentType = request.raw.headers['content-type'] || ''
      let release: (() => void | Promise<void>) | undefined
      try {
        let input: CreateTask
        if (contentType.startsWith('multipart/form-data')) {
          const result = await upload(ctx, request, version === 'v1' ? config.defaultWorkflowId || 'youdub.localize' : undefined)
          input = result.input; release = result.release
        } else {
          input = await readJson(request)
          if (Object.keys(input.inputs || {}).length || input.artifacts) throw new HttpError(422, 'INVALID_INPUT', 'Upload files as named multipart inputs.')
          input.inputs = {}; requireId(input.id)
          release = await ctx.files.reserve(input.id, true)
        }
        const task = await ctx.tasks.create(input)
        ctx.http.json(request, 201, await project(task))
      } finally { await release?.() }
    })
    route('GET', `${base}/tasks`, async request => {
      const query = request.url.searchParams
      const limit = Number(query.get('limit') || 20), offset = Number(query.get('offset') || 0)
      if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0) throw new HttpError(422, 'INVALID_CONFIG', 'Invalid pagination.')
      const filters = { limit, offset, status: query.get('status') || undefined, active: query.has('active') ? query.get('active') === 'true' : undefined }
      if (version === 'v1') {
        const page = await ctx.store.call('store.list', { ...filters, compatibleWorkflowId: config.defaultWorkflowId || 'youdub.localize' })
        ctx.http.json(request, 200, { items: await Promise.all(page.items.map(async (task: any) => legacy(await ctx.tasks.get(task.id)))), limit, offset, has_more: page.hasMore ?? page.has_more })
      } else {
        const page = await ctx.tasks.list(filters)
        ctx.http.json(request, 200, { ...page, items: await Promise.all(page.items.map(view)) })
      }
    })
    route('GET', `${base}/tasks/:id`, async request => ctx.http.json(request, 200, await project(await ctx.tasks.get(request.params.id!))))
    for (const action of ['cancel', 'retry', 'rerun'] as const) route('POST', `${base}/tasks/:id/${action}`, async request => {
      const body = await readJson(request)
      const id = request.params.id!
      const current = await ctx.tasks.get(id)
      if (version === 'v1') await legacy(current)
      const task = action === 'rerun' ? await ctx.tasks.rerun(id, { id: body.id, config: body.config, workflowId: version === 'v1' ? config.defaultWorkflowId || 'youdub.localize' : body.workflowId, acknowledgeExternalRisk: body.acknowledgeExternalRisk ?? body.acknowledge_external_risk }) : await ctx.tasks[action](id, body.expectedAttempt ?? body.expected_attempt ?? current.attempt)
      ctx.http.json(request, action === 'rerun' ? 201 : task.status === 'cancelling' ? 202 : 200, await project(task))
    })
    route('DELETE', `${base}/tasks/:id`, async request => {
      const task = await ctx.tasks.get(request.params.id!)
      if (version === 'v1') await legacy(task)
      await ctx.tasks.delete(task.id, Number(request.url.searchParams.get('expectedAttempt') || task.attempt))
      ctx.http.json(request, 204)
    })
    route('GET', `${base}/tasks/:id/files/:output`, async request => {
      const id = request.params.id!, unlock = ctx.files.readLock(id)
      try {
        const task = await ctx.tasks.record(id)
        if (version === 'v1') await legacy(await ctx.tasks.get(id))
        const output = task.outputs.find(item => item.id === request.params.output || version === 'v1' && item.role === request.params.output)
        const artifact = output && task.artifacts[output.artifact.id]
        if (!artifact) throw new HttpError(404, 'OUTPUT_NOT_FOUND', 'Output not found.')
        await ctx.http.file(request, await ctx.files.resolve(id, artifact), { mime: artifact.mimeType, name: artifact.name, download: request.url.searchParams.get('download') === 'true' })
      } finally { await unlock() }
    })
    route('GET', `${base}/tasks/:id/log`, async request => {
      const lines = Number(request.url.searchParams.get('lines') || 200)
      if (!Number.isInteger(lines) || lines < 1 || lines > 1000) throw new HttpError(422, 'INVALID_CONFIG', 'Invalid log line count.')
      await ctx.tasks.get(request.params.id!)
      const log = await ctx.files.readLog(request.params.id!, lines)
      request.response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }); request.response.end(log)
    })
  }
  route('GET', '/api/v2/extensions', request => ctx.http.json(request, 200, ctx.extensions.list()))
  route('DELETE', '/api/v2/imports/:id', async request => {
    const id = request.params.id!, release = await ctx.files.reserve(id)
    try {
      try { await ctx.tasks.record(id); throw new HttpError(409, 'TASK_EXISTS', 'This import already belongs to a task. Use the task action.') }
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

async function upload(ctx: Context, request: HttpRequest, legacyWorkflow?: string) {
  const fields: Record<string, string> = {}, artifacts: Record<string, Artifact> = {}, inputs: Record<string, { id: string; schemaId: string }> = {}
  let metadata: any, release: (() => void | Promise<void>) | undefined, reservation: Promise<void> | undefined, failure: unknown
  const jobs: Promise<void>[] = []
  const parser = Busboy({ headers: request.raw.headers, limits: { files: 16, fields: 8, fieldSize: 1024 * 1024, fileSize: 4 * 1024 * 1024 * 1024 } })
  parser.on('field', (name, value, info) => {
    if (info.valueTruncated) { failure = new HttpError(413, 'FILE_TOO_LARGE', 'Metadata too large.'); return }
    fields[name] = value
    if (name === 'request') { try { metadata = JSON.parse(value) } catch { failure = new HttpError(400, 'INVALID_JSON', 'Invalid request metadata.') } }
  })
  parser.on('file', (name, stream, info) => {
    const job = (async () => {
      if (legacyWorkflow && name === 'config') {
        const parts: Buffer[] = []; let size = 0
        for await (const chunk of stream) { size += chunk.length; if (size > 1024 * 1024) throw new HttpError(413, 'FILE_TOO_LARGE', 'Configuration too large.'); parts.push(chunk) }
        fields.config = Buffer.concat(parts).toString('utf8'); return
      }
      const id = metadata?.id || fields.id
      requireId(id)
      reservation ??= ctx.files.reserve(id, true).then(dispose => { release = dispose })
      await reservation
      const slot = legacyWorkflow && name === 'file' ? 'video' : name.startsWith('input.') ? name.slice(6) : ''
      if (!slot || inputs[slot]) throw new HttpError(422, 'INVALID_INPUT', 'Expected unique input.<name> file fields.')
      const workflowId = metadata?.workflowId || legacyWorkflow
      if (!workflowId) throw new HttpError(422, 'INVALID_CONFIG', 'Send request metadata before input files.')
      const descriptor = ctx.catalog.workflow(workflowId).describe().inputs.find(item => item.name === slot)
      if (!descriptor) throw new HttpError(422, 'INVALID_INPUT', `Unknown workflow input: ${slot}`)
      stream.once('limit', () => { failure = new HttpError(413, 'FILE_TOO_LARGE', 'Input exceeds upload limit.') })
      const artifact = await ctx.files.upload(id, slot, info.filename, info.mimeType, stream, descriptor.maxBytes)
      artifacts[artifact.id] = artifact; inputs[slot] = { id: artifact.id, schemaId: artifact.schemaId }
    })().catch(error => { failure ??= error; stream.resume() })
    jobs.push(job)
  })
  parser.on('filesLimit', () => { failure = new HttpError(413, 'FILE_TOO_LARGE', 'Too many input files.') })
  parser.on('fieldsLimit', () => { failure = new HttpError(413, 'FILE_TOO_LARGE', 'Too many metadata fields.') })
  try {
    await new Promise<void>((resolve, reject) => { parser.once('close', resolve); parser.once('error', reject); request.raw.once('aborted', () => reject(new Error('Upload interrupted.'))); request.raw.pipe(parser) })
    await Promise.all(jobs)
    if (failure) throw failure
    metadata ||= { id: fields.id, workflowId: legacyWorkflow, config: JSON.parse(fields.config || '{}') }
    requireId(metadata.id)
    return { release, input: { ...metadata, inputs, artifacts, sourceName: Object.values(artifacts)[0]?.name || metadata.workflowId } as CreateTask }
  } catch (error) { await Promise.all(jobs); await release?.(); throw error }
}
