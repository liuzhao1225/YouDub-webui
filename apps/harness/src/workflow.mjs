import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { resolve, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write';

export class WorkflowError extends Error {
  constructor(message, status = 409, code = 'INVALID_STATE') { super(message); this.status = status; this.code = code; }
}
const editable = new Set(['awaiting_review', 'confirmed', 'exported']);
const diagnostic = error => ({ code: error.code || 'WORKFLOW_FAILED', message: error.message, ...(error.details ? { details: error.details } : {}) });

// Deliberately one subtitle-specific checkpoint, not a second general workflow engine.
export class SubtitleWorkflow {
  constructor(root, runner) { this.root = root; this.runner = runner; this.active = null; this.locks = new Set(); }
  dir(id) {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new WorkflowError('任务 ID 无效', 400, 'INVALID_ID');
    return resolve(this.root, id);
  }
  async init() {
    await mkdir(this.root, { recursive: true });
    for (const task of await this.list()) {
      if (['recognizing', 'exporting'].includes(task.status)) {
        task.status = 'failed';
        task.error = { code: 'HOST_INTERRUPTED', message: '上次执行被中断。请重新导入视频。' };
        await this.save(task);
      }
    }
  }
  async get(id) {
    try { return JSON.parse(await readFile(resolve(this.dir(id), 'task.json'), 'utf8')); }
    catch (error) {
      if (error.code === 'ENOENT') throw new WorkflowError('任务不存在', 404, 'NOT_FOUND');
      throw error;
    }
  }
  async list() {
    const entries = await readdir(this.root, { withFileTypes: true });
    return (await Promise.all(entries.filter(e => e.isDirectory() && /^[0-9a-f-]{36}$/.test(e.name)).map(async e => {
      try { return await this.get(e.name); }
      catch (error) { if (error.code === 'NOT_FOUND') return null; throw error; } // unfinished uploads have no task yet
    }))).filter(Boolean).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async save(task) {
    task.updatedAt = new Date().toISOString();
    task.revision += 1;
    const path = resolve(this.dir(task.id), 'task.json');
    await writeFileAtomic(path, JSON.stringify(task, null, 2) + '\n', { mode: 0o600, dirMode: 0o700 });
  }
  async locked(id, revision, fn) {
    if (this.locks.has(id)) throw new WorkflowError('任务正在保存，请稍后重试');
    this.locks.add(id);
    try {
      const task = await this.get(id);
      if (task.revision !== revision) throw new WorkflowError('任务已有更新，请重新加载后操作', 409, 'STALE_REVISION');
      return await fn(task);
    } finally { this.locks.delete(id); }
  }
  async importVideo(name, stream, mimeType = 'application/octet-stream') {
    if (!stream) throw new WorkflowError('请选择视频文件', 400, 'EMPTY_UPLOAD');
    const id = randomUUID();
    await mkdir(this.dir(id));
    let size = 0;
    await pipeline(Readable.fromWeb(stream), new Transform({ transform(chunk, _, done) {
      size += chunk.length;
      if (size > 512 * 1024 ** 2) return done(new WorkflowError('视频不能超过 512 MB', 413, 'UPLOAD_TOO_LARGE'));
      done(null, chunk);
    } }), createWriteStream(resolve(this.dir(id), 'source.video'), { flags: 'wx' }));
    if (size === 0) throw new WorkflowError('视频文件为空', 400, 'EMPTY_UPLOAD');
    const task = { id, sourceName: basename(name || 'video').slice(0, 160), size, mimeType, revision: 0, status: 'imported',
      transcript: null, confirmedRevision: null, error: null, progress: null, createdAt: new Date().toISOString() };
    await this.save(task);
    return task;
  }
  async recognize(id, revision, language) {
    if (!['auto', 'en', 'zh', 'ja'].includes(language)) throw new WorkflowError('识别语言无效', 400, 'INVALID_LANGUAGE');
    return this.locked(id, revision, async task => {
      if (task.status !== 'imported') throw new WorkflowError('当前任务不能开始识别');
      if (this.active) throw new WorkflowError('另一个视频正在识别，请等待完成', 409, 'WORKER_BUSY');
      const controller = new AbortController();
      // Reserve before the first await so concurrent tasks cannot both start.
      const active = this.active = { controller, done: null };
      task.status = 'recognizing'; task.language = language; task.error = null;
      try { await this.save(task); }
      catch (error) { this.active = null; throw error; }
      const response = structuredClone(task);
      active.done = (async () => {
        try {
          const result = await this.runner.recognize(task, controller.signal, async (value, message) => {
            task.progress = { value, message }; await this.save(task);
          });
          task.transcript = result.transcript;
          task.mediaInfo = result.mediaInfo;
          await writeFile(resolve(this.dir(id), 'asr.original.json'), JSON.stringify(result.transcript, null, 2) + '\n');
          task.status = 'awaiting_review'; task.progress = null;
          await this.save(task);
        } catch (error) {
          task.status = 'failed'; task.error = diagnostic(error); task.progress = null;
          console.error(`[YouDub ${id}]`, error);
          await this.save(task);
        } finally { this.active = null; }
      })();
      // Unexpected checkpoint-write rejection reaches Harness's fail-loud
      // unhandled-rejection handler. It must stop the Host, not leave a live
      // server advertising a stale recognizing checkpoint.
      return response;
    });
  }
  async edit(id, revision, segments) {
    return this.locked(id, revision, async task => {
      if (!editable.has(task.status)) throw new WorkflowError('识别完成后才能修改字幕');
      const originals = task.transcript.segments;
      if (!Array.isArray(segments) || segments.length !== originals.length || new Set(segments.map(s => s.id)).size !== originals.length) {
        throw new WorkflowError('字幕条目不完整', 422, 'INVALID_TRANSCRIPT');
      }
      const texts = new Map(segments.map(s => [s.id, s.text]));
      task.transcript.segments = originals.map(segment => {
        const text = texts.get(segment.id);
        if (typeof text !== 'string' || !text.trim() || text.length > 10000) throw new WorkflowError('字幕不能为空，且每条不能超过 10000 字符', 422, 'INVALID_TRANSCRIPT');
        return text === segment.text ? segment : { ...segment, text, words: null };
      });
      task.status = 'awaiting_review'; task.confirmedRevision = null;
      await this.save(task);
      return task;
    });
  }
  async confirm(id, revision) {
    return this.locked(id, revision, async task => {
      if (task.status !== 'awaiting_review') throw new WorkflowError('请先完成字幕校对');
      task.status = 'confirmed'; task.confirmedRevision = task.revision + 1;
      await this.save(task);
      return task;
    });
  }
  async export(id, revision) {
    return this.locked(id, revision, async task => {
      if (!['confirmed', 'exported'].includes(task.status) || task.confirmedRevision === null) throw new WorkflowError('请先确认字幕再导出', 409, 'REVIEW_REQUIRED');
      task.status = 'exporting';
      await this.save(task);
      try {
        await writeFile(resolve(this.dir(id), 'transcript.confirmed.json'), JSON.stringify(task.transcript, null, 2) + '\n');
        await this.runner.export(task);
        const body = await readFile(resolve(this.dir(id), 'subtitles.srt'));
        task.status = 'exported'; await this.save(task);
        return body;
      } catch (error) {
        task.status = 'failed'; task.error = diagnostic(error);
        await this.save(task);
        throw error;
      }
    });
  }
  async close() {
    if (this.active) { const { controller, done } = this.active; controller.abort(new Error('Harness host stopped')); await done; }
  }
}
