import { Service, type Context } from 'cordis'
import { createWriteStream } from 'node:fs'
import { mkdir, stat, realpath, readFile, appendFile, rm, copyFile, rename } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import { Transform, type Readable } from 'node:stream'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { AppError, requireId, type Artifact, type ArtifactDescriptor, type FilesService, type TaskRecord } from '@youdub/sdk'

export default class Files extends Service implements FilesService {
  static inject = ['process']
  root: string
  private writes = new Set<string>()
  private readers = new Map<string, number>()
  private covers = new Map<string, Promise<{ path: string; mimeType: string }>>()
  constructor(ctx: Context, config: { root: string }) { super(ctx, 'files'); this.root = path.resolve(config.root) }
  async [Service.init]() { await mkdir(this.root, { recursive: true, mode: 0o700 }) }
  taskRoot(id: string) { requireId(id); return path.join(this.root, 'tasks', id) }
  async reserve(id: string, fresh = false) {
    const root = this.taskRoot(id)
    if (this.writes.has(id) || this.readers.get(id)) throw new AppError('TASK_BUSY', 'Task files are in use.', 409)
    this.writes.add(id)
    try {
      if (fresh) {
        await mkdir(path.dirname(root), { recursive: true, mode: 0o700 })
        try { await mkdir(root, { mode: 0o700 }) }
        catch (error: any) { if (error.code === 'EEXIST') throw new AppError('IMPORT_RESIDUE', 'Files already exist for this ID. Inspect or delete the residual import.', 409); throw error }
      }
    } catch (error) { this.writes.delete(id); throw error }
    return () => { this.writes.delete(id) }
  }
  readLock(id: string) {
    requireId(id)
    if (this.writes.has(id)) throw new AppError('TASK_BUSY', 'Task files are being modified.', 409)
    this.readers.set(id, (this.readers.get(id) ?? 0) + 1)
    let released = false
    return () => { if (released) return; released = true; const count = this.readers.get(id)! - 1; if (count) this.readers.set(id, count); else this.readers.delete(id) }
  }
  async upload(id: string, slot: string, filename: string, mime: string, input: Readable, maxBytes: number) {
    if (!/^[a-zA-Z][\w-]{0,63}$/.test(slot)) throw new AppError('INVALID_CONFIG', 'Invalid input slot.', 422)
    const clean = path.basename(filename.replaceAll('\\', '/'))
    if (!clean || /[\x00-\x1f]/.test(clean)) throw new AppError('INVALID_CONFIG', 'Invalid file name.', 422)
    const directory = path.join(this.taskRoot(id), 'input'); await mkdir(directory, { recursive: true, mode: 0o700 })
    const destination = path.join(directory, slot + path.extname(clean).toLowerCase())
    let bytes = 0
    await pipeline(input, new Transform({ transform(chunk, _, callback) {
      bytes += chunk.length
      callback(bytes > maxBytes ? new AppError('FILE_TOO_LARGE', 'Input exceeds the configured size limit.', 413) : null, chunk)
    } }), createWriteStream(destination, { flags: 'wx', mode: 0o600 }))
    if (!bytes) throw new AppError('INVALID_MEDIA', 'Input file is empty.', 422)
    return { id: randomUUID(), schemaId: 'file/v1', path: path.relative(this.taskRoot(id), destination), mimeType: mime || 'application/octet-stream', name: clean, size: bytes, metadata: {}, invocationId: 'input' }
  }
  async workDir(id: string, attempt: number, invocationId: string) {
    requireId(invocationId)
    const work = path.join(this.taskRoot(id), 'attempts', String(attempt), invocationId)
    await mkdir(work, { recursive: true, mode: 0o700 }); return work
  }
  async register(id: string, invocationId: string, workDir: string, descriptor: ArtifactDescriptor): Promise<Artifact> {
    if (!descriptor || typeof descriptor.path !== 'string' || path.isAbsolute(descriptor.path) || !descriptor.mimeType || !descriptor.schemaId) throw new AppError('INVALID_PROVIDER_RESULT', 'Invalid artifact descriptor.', 500)
    const base = await realpath(workDir), file = await realpath(path.resolve(base, descriptor.path))
    const taskRoot = await realpath(this.taskRoot(id))
    if (!file.startsWith(base + path.sep) || !base.startsWith(taskRoot + path.sep)) throw new AppError('INVALID_PROVIDER_RESULT', 'Artifact is outside the invocation workspace.', 500)
    const info = await stat(file)
    if (!info.isFile() || info.size <= 0) throw new AppError('STAGE_OUTPUT_MISSING', 'Artifact is empty or missing.', 500)
    const metadata = { ...descriptor.metadata }
    if (descriptor.mimeType === 'application/json') JSON.parse(await readFile(file, 'utf8'))
    if (/^(audio|video)\//.test(descriptor.mimeType)) {
      const result = await this.ctx.process.run({ command: process.env.FFPROBE_PATH || 'ffprobe', args: ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file] })
      const probe = JSON.parse(result.stdout)
      if (!probe.streams?.some((stream: any) => stream.codec_type === descriptor.mimeType.split('/')[0])) throw new AppError('INVALID_PROVIDER_RESULT', 'Artifact has no declared media stream.', 500)
      metadata.durationMs = Math.round(Number(probe.format.duration) * 1000)
    }
    return { id: randomUUID(), schemaId: descriptor.schemaId, path: path.relative(taskRoot, file), mimeType: descriptor.mimeType, name: path.basename(file), size: info.size, metadata, invocationId }
  }
  async resolve(id: string, artifact: Artifact) {
    const root = await realpath(this.taskRoot(id)), file = await realpath(path.resolve(root, artifact.path))
    if (!file.startsWith(root + path.sep)) throw new AppError('OUTPUT_NOT_FOUND', 'Artifact is outside its task.', 404)
    const info = await stat(file)
    if (!info.isFile() || info.size !== artifact.size) throw new AppError('OUTPUT_NOT_FOUND', 'Registered artifact changed or is missing.', 404)
    return file
  }
  async log(id: string, text: string) {
    await appendFile(path.join(this.taskRoot(id), 'task.log'), `[${new Date().toISOString()}] ${text}\n`, { mode: 0o600 })
  }
  async cover(id: string, artifact: Artifact) {
    const source = await this.resolve(id, artifact)
    if (artifact.mimeType.startsWith('image/')) return { path: source, mimeType: artifact.mimeType }
    const key = `${id}:${artifact.id}`
    let pending = this.covers.get(key)
    if (!pending) {
      pending = this.videoCover(id, artifact, source)
      this.covers.set(key, pending)
    }
    try { return await pending }
    finally { if (this.covers.get(key) === pending) this.covers.delete(key) }
  }
  private async videoCover(id: string, artifact: Artifact, source: string) {
    const root = await realpath(this.taskRoot(id)), directory = path.join(root, 'covers')
    await mkdir(directory, { recursive: true, mode: 0o700 })
    if (await realpath(directory) !== directory) throw new AppError('INVALID_COVER_PATH', 'Cover cache must be inside its task directory.', 500)
    const destination = path.join(directory, createHash('sha256').update(artifact.id).digest('hex') + '.jpg')
    try {
      const cached = await realpath(destination), info = await stat(cached)
      if (cached !== destination || !info.isFile() || !info.size) throw new AppError('INVALID_COVER_CACHE', `Invalid cover cache for task ${id}, artifact ${artifact.id}.`, 500)
      return { path: cached, mimeType: 'image/jpeg' }
    } catch (error: any) { if (error.code !== 'ENOENT') throw error }
    const temporary = path.join(directory, `${randomUUID()}.jpg`)
    try {
      await this.ctx.process.run({ command: process.env.FFMPEG_PATH || 'ffmpeg', args: ['-nostdin', '-v', 'error', '-i', source, '-map', '0:v:0', '-frames:v', '1', '-vf', "scale='min(960,iw)':-2", '-q:v', '3', '-threads', '1', '-n', temporary] })
      const info = await stat(temporary)
      if (!info.isFile() || !info.size) throw new AppError('COVER_GENERATION_FAILED', 'FFmpeg did not produce a cover image.', 500)
      await rename(temporary, destination)
      return { path: destination, mimeType: 'image/jpeg' }
    } catch (error: any) {
      error.message = `Cover for task ${id}, artifact ${artifact.id}: ${error.message}`
      throw error
    } finally { await rm(temporary, { force: true }) }
  }
  async readLog(id: string, lines = 200) {
    try { return (await readFile(path.join(this.taskRoot(id), 'task.log'), 'utf8')).split('\n').slice(-Math.min(Math.max(lines, 1), 10000)).join('\n') }
    catch (error: any) { if (error.code === 'ENOENT') return ''; throw error }
  }
  async remove(id: string) { await rm(this.taskRoot(id), { recursive: true, force: true }) }
  async copyInputs(from: TaskRecord, newId: string) {
    const inputs: TaskRecord['inputs'] = {}, artifacts: TaskRecord['artifacts'] = {}
    const directory = path.join(this.taskRoot(newId), 'input'); await mkdir(directory, { recursive: true, mode: 0o700 })
    for (const [key, ref] of Object.entries(from.inputs)) {
      const previous = from.artifacts[ref.id]
      const source = await this.resolve(from.id, previous), target = path.join(directory, key + path.extname(previous.name))
      await copyFile(source, target, 1)
      const artifact = { ...previous, id: randomUUID(), invocationId: 'input', path: path.relative(this.taskRoot(newId), target) }
      artifacts[artifact.id] = artifact; inputs[key] = { id: artifact.id, schemaId: artifact.schemaId }
    }
    return { inputs, artifacts }
  }
}
