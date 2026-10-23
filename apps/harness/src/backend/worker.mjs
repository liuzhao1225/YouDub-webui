import { Service } from '@deepseek-ai/cordis';
import { randomUUID } from 'node:crypto';
import { AppError } from '../../../../packages/sdk/src/index.ts';
import { StringDecoder } from 'node:string_decoder';
import { runProcess, runWorker } from '../process.mjs';
const fail = (code, message, status = 503, details) => new AppError(code, message, status, details);

// This is solely the YouDub JSONL protocol. Harness owns every subprocess,
// inherited environment, pipe, cancellation signal and process-range cleanup.
export default class YouDubWorker extends Service {
  static inject = ['subprocess'];
  constructor(ctx, config) { super(ctx, 'youdubWorker'); this.config = config; }
  request(request) { return { ...request, env: { ...this.config.env, ...request.env } }; }
  run(request) { return runProcess(this.ctx.subprocess, this.request(request)); }
  worker(request, invocation, context) { return runWorker(this.ctx.subprocess, this.request(request), invocation, context); }
  async rpc(request) {
    const handle = this.ctx.subprocess.spawn({ argv: [request.command, ...request.args], cwd: request.cwd,
      env: { ...this.config.env, ...request.env, PYTHONUNBUFFERED: '1', PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
      signal: request.signal, graceMs: 5000, stdio: { stdin: 'pipe', stdout: 'pipe', stderr: { maxBytes: 1024 * 1024 } } });
    const storageBridge = request.args.includes('backend.workers.bridge');
    const storageMethods = new Set(['settings.raw', 'settings.validate_defaults', 'runtime.info', 'runtime.probe']);
    const pending = new Map(); let inputSeq = 0, outputSeq = 0, fatal, closing = false, closingPromise;
    const rejectAll = error => {
      fatal ??= error;
      for (const item of pending.values()) item.reject(fail('COMMIT_OUTCOME_UNKNOWN', `Storage ${item.method} lost its response: ${error.message}`, 503, { cause: error.message }));
      pending.clear();
    };
    handle.stdin.on('error', error => { rejectAll(error); handle.terminate(); });
    const reader = (async () => {
      const decoder = new StringDecoder('utf8'); let buffer = '';
      for await (const chunk of handle.stdout) {
        buffer += decoder.write(chunk);
        if (Buffer.byteLength(buffer) > 32 * 1024 * 1024) throw fail('PROTOCOL_ERROR', 'Storage bridge message exceeds 32 MiB.');
        let end;
        while ((end = buffer.indexOf('\n')) >= 0) {
          const message = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
          if (message.version !== 'youdub-worker/v1' || message.seq !== ++outputSeq) throw fail('PROTOCOL_ERROR', 'Storage bridge protocol mismatch.');
          const item = pending.get(message.requestId);
          if (!item || !['result', 'error'].includes(message.type)) throw fail('PROTOCOL_ERROR', 'Unknown storage bridge response.');
          pending.delete(message.requestId);
          if (message.type === 'error') item.reject(fail(message.payload.code ?? 'STORE_ERROR', message.payload.message, message.payload.status ?? 500, message.payload));
          else item.resolve(message.payload);
        }
      }
      buffer += decoder.end();
      if (buffer.trim()) throw fail('PROTOCOL_ERROR', 'Storage bridge exited with an incomplete message.');
    })();
    const done = Promise.all([reader, handle.done]).then(([, exit]) => {
      if (!closing || exit.exitCode !== 0) throw fail('STORE_UNAVAILABLE', `Storage bridge exited (${exit.exitCode ?? exit.signal}): ${handle.collected.stderr.readFrom(0).text}`);
      if (pending.size) throw fail('COMMIT_OUTCOME_UNKNOWN', 'Storage bridge stopped with pending transactions.');
    }).catch(error => { rejectAll(error); handle.terminate(); throw error; });
    // Readers start before the first storage call; each call and close observes fatal.
    void done.catch(error => this.ctx.logger.error(error));
    const close = () => closingPromise ??= (async () => {
      closing = true; handle.stdin.end();
      try { await done; if (fatal) throw fatal; }
      finally { handle.terminate(); if (!await handle.waitForExit(AbortSignal.timeout(10000))) throw fail('CANCEL_TIMEOUT', 'Storage process range did not stop.'); }
    })();
    this.ctx.effect(() => close);
    return { call(method, params = {}) {
      if (storageBridge && (!(method.startsWith('store.') || storageMethods.has(method) || method === 'settings.write' && params.key === 'plugin:youdub.localize') || method === 'runtime.probe' && params.adapter === 'openai')) return Promise.reject(fail('HARNESS_SERVICES_REQUIRED', 'Authentication, credentials and model configuration belong to Harness services.', 409));
      if (fatal) return Promise.reject(fatal);
      if (closing) return Promise.reject(fail('STORE_UNAVAILABLE', 'Storage bridge is closed.'));
      const requestId = randomUUID();
      return new Promise((resolve, reject) => {
        pending.set(requestId, { resolve, reject, method });
        handle.stdin.write(JSON.stringify({ version: 'youdub-worker/v1', requestId, seq: ++inputSeq, type: 'request', payload: { method, params } }) + '\n', error => {
          if (error) { rejectAll(error); handle.terminate(); }
        });
      });
    }, close };
  }
}
