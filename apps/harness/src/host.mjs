import { readFile, stat, access } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import z from '@deepseek-ai/schemastery';
import { SubtitleWorkflow, WorkflowError } from './workflow.mjs';
import { runProcess, runWorker } from './process.mjs';

export const name = 'youdub-subtitles';
export const inject = ['connection', 'subprocess', 'jobs'];
export const Config = z.object({
  python: z.string().required(),
  modelsDir: z.string().required(),
  dataDir: z.string().required(),
});
export async function apply(ctx, config) {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const data = resolve(config.dataDir);
  await access(config.python);
  await access(resolve(config.modelsDir, 'tiny.pt'));
  const request = { command: config.python, cwd: root,
    env: { PYTHONPATH: root, YOUDUB_DESKTOP_DATA_DIR: resolve(data, 'runtime'), YOUDUB_WHISPER_MODELS_DIR: resolve(config.modelsDir) } };
  ctx.effect(() => ctx.jobs.attachController('youdub-subtitles'));
  async function recognizeTask(task, signal, progress) {
    const taskDir = workflow.dir(task.id);
    const artifacts = new Map();
    async function invoke(operation, inputs, step) {
      const workDir = resolve(taskDir, step);
      const context = { signal, progress, credentials: {},
        externalPrepare: async () => { throw new Error('External providers are not part of this local subtitle profile'); },
        externalUpdate: async () => { throw new Error('Unexpected external provider update'); },
        register: async descriptor => {
          const id = randomUUID(); const path = resolve(workDir, descriptor.path);
          if (!path.startsWith(workDir + '/')) throw new Error('Worker artifact escaped its workspace');
          await stat(path); artifacts.set(id, path);
          return { id, schemaId: descriptor.schemaId };
        },
        resolve: async ref => { const path = artifacts.get(ref.id); if (!path) throw new Error('Unknown artifact'); return path; },
      };
      const result = await runWorker(ctx.subprocess, { ...request, args: ['-m', 'backend.workers.operation'], signal }, {
        taskId: task.id, attempt: 1, invocationId: randomUUID(), operation, taskDir, workDir, inputs,
        binding: { model: 'tiny', device: 'cpu', options: { sourceLanguage: task.language } }, config: { graph: true },
      }, context);
      if (result.state !== 'completed') throw new Error('Local worker did not complete');
      return result.outputs;
    }
    const prepared = await invoke('media.prepare/v1', { video: { path: resolve(taskDir, 'source.video') } }, 'prepare');
    const recognized = await invoke('speech.transcribe/v1', { audio: prepared.sourceAudio, mediaInfo: prepared.mediaInfo }, 'recognize');
    return { transcript: recognized.transcript, mediaInfo: prepared.mediaInfo };
  }
  const workflow = new SubtitleWorkflow(resolve(data, 'tasks'), {
    async recognize(task, signal, progress) {
      let result;
      const controller = new AbortController();
      const combined = AbortSignal.any([signal, controller.signal]);
      ctx.jobs.start({
        kind: 'youdub-subtitles', label: `识别字幕：${task.sourceName}`,
        run(job) {
          result = recognizeTask(task, combined, async (value, message) => {
            await progress(value, message);
            job.updateProgress(message || (value === null ? '正在识别' : `${Math.round(value * 100)}%`));
          });
          return {
            cancel(reason) { controller.abort(new Error(reason || 'Subtitle recognition cancelled')); },
            done: result.then(
              () => ({ status: 'completed' }),
              error => ({ status: combined.aborted ? 'killed' : 'failed', detail: `${error.code ? `${error.code}: ` : ''}${error.message}` }),
            ),
          };
        },
      });
      // The same original error also reaches the durable subtitle checkpoint.
      return result;
    },
    async export(task) {
      const taskDir = workflow.dir(task.id);
      await runProcess(ctx.subprocess, { ...request, args: [resolve(root, 'apps/harness/export_subtitles.py'),
        resolve(taskDir, 'transcript.confirmed.json'), resolve(taskDir, 'subtitles.srt'), String(task.mediaInfo.duration_ms)] });
    },
  });
  await workflow.init();
  ctx.effect(() => () => workflow.close());
  function route(path, methods, bodyMode, handler) {
    ctx.effect(() => ctx.connection.fetch.register({ path: `/api/youdub/${path}`, methods, requestBody: bodyMode,
      async fetch(request) {
        try { return await handler(request, new URL(request.url)); }
        catch (error) {
          console.error(`[YouDub ${path}]`, error);
          return Response.json({ error: { code: error.code || 'INTERNAL_ERROR', message: error.message } }, { status: error.status || 500 });
        }
      },
    }));
  }
  route('tasks', ['GET'], 'buffered', async () => Response.json(await workflow.list()));
  route('import', ['POST'], 'streaming', async (req, url) => Response.json(await workflow.importVideo(url.searchParams.get('name'), req.body, req.headers.get('content-type') || 'application/octet-stream'), { status: 201 }));
  route('recognize', ['POST'], 'buffered', async req => { const b = await req.json(); return Response.json(await workflow.recognize(b.id, b.revision, b.language)); });
  route('edit', ['POST'], 'buffered', async req => { const b = await req.json(); return Response.json(await workflow.edit(b.id, b.revision, b.segments)); });
  route('confirm', ['POST'], 'buffered', async req => { const b = await req.json(); return Response.json(await workflow.confirm(b.id, b.revision)); });
  route('export', ['POST'], 'buffered', async req => {
    const b = await req.json(); await workflow.export(b.id, b.revision);
    return Response.json(await workflow.get(b.id));
  });
  route('download', ['GET'], 'buffered', async (_req, url) => {
    const id = url.searchParams.get('id'), task = await workflow.get(id);
    if (task.status !== 'exported' || task.confirmedRevision == null) throw new WorkflowError('请先确认并导出字幕', 409, 'EXPORT_REQUIRED');
    const filename = `${task.sourceName.replace(/\.[^.]+$/, '')}.srt`;
    const encoded = encodeURIComponent(filename).replace(/[!'()*]/g, value => `%${value.charCodeAt(0).toString(16).toUpperCase()}`);
    return new Response(await readFile(resolve(workflow.dir(id), 'subtitles.srt')), {
      headers: { 'content-type': 'application/x-subrip; charset=utf-8', 'content-disposition': `attachment; filename="subtitles.srt"; filename*=UTF-8''${encoded}`, 'cache-control': 'no-store' },
    });
  });
  route('video', ['GET', 'HEAD'], 'buffered', async (req, url) => {
    const id = url.searchParams.get('id'); const task = await workflow.get(id);
    const path = resolve(workflow.dir(id), 'source.video'); const { size } = await stat(path);
    const range = req.headers.get('range'); let start = 0, end = size - 1;
    if (range) {
      const match = /^bytes=(\d+)-(\d*)$/.exec(range);
      if (!match) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } });
      start = Number(match[1]); end = match[2] ? Math.min(Number(match[2]), size - 1) : end;
      if (start > end) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } });
    }
    const headers = { 'content-type': task.mimeType || 'video/mp4', 'accept-ranges': 'bytes', 'content-length': String(end - start + 1), 'cache-control': 'no-store' };
    if (range) headers['content-range'] = `bytes ${start}-${end}/${size}`;
    return new Response(req.method === 'HEAD' ? null : Readable.toWeb(createReadStream(path, { start, end })), { status: range ? 206 : 200, headers });
  });
  // The unchanged BrandMark component embeds its original wordmark asset.
  ctx.inject(['webServer'], web => web.effect(() => web.webServer.register({ path: '/youdub-logo.svg', kind: 'exact',
    handler: async (_req, res) => { res.writeHead(200, { 'content-type': 'image/svg+xml' }); res.end(await readFile(resolve(root, 'apps/web/public/youdub-logo.svg'))); },
  })));
}
