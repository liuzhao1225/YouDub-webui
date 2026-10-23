import { Readable } from 'node:stream';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
export const fileURL = path => `/api/youdub/file?path=${encodeURIComponent(path)}`;
const error = (code, message, status) => Object.assign(new Error(message), { code, status });
export const readJson = async request => request.body ?? {};

// The route table is the YouDub business API. It never opens a server or admits
// peers: all requests have already passed the official Connection owner policy.
export class YouDubTransport {
  constructor(ctx) { this.ctx = ctx; this.routes = []; }
  register(method, path, handler) {
    const names = [];
    const expression = '^' + path.split('/').map(part => {
      if (!part.startsWith(':')) return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      names.push(part.slice(1).replace(/\*$/, '')); return part.endsWith('*') ? '(.*)' : '([^/]+)';
    }).join('/') + '$';
    const route = { method, pattern: new RegExp(expression), names, handler };
    this.routes.push(route); return () => { this.routes.splice(this.routes.indexOf(route), 1); };
  }
  json(request, status, value) { request.result = status === 204 ? new Response(null, { status }) : Response.json(value, { status }); }
  async file(request, path, options = {}) {
    const { size } = await stat(path), range = request.physical.headers.get('range'); let start = 0, end = size - 1;
    const headers = new Headers({ 'content-type': options.mime || 'application/octet-stream', 'cache-control': 'no-store', 'accept-ranges': 'bytes' });
    if (options.name || options.download) {
      const name = options.name || 'download';
      const asciiName = name.replace(/[^\x20-\x7e]|["\\/]/g, '_');
      headers.set('content-disposition', `${options.download ? 'attachment' : 'inline'}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(name).replace(/[!'()*]/g, value => '%' + value.charCodeAt(0).toString(16).toUpperCase())}`);
    }
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match || !match[1] && !match[2]) { request.result = new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } }); return; }
      if (match[1]) { start = Number(match[1]); if (match[2]) end = Math.min(end, Number(match[2])); }
      else start = Math.max(0, size - Number(match[2]));
      if (start > end || start >= size) { request.result = new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } }); return; }
      headers.set('content-range', `bytes ${start}-${end}/${size}`);
    }
    headers.set('content-length', String(Math.max(0, end - start + 1)));
    let body = null;
    if (request.physical.method !== 'HEAD' && size > 0) {
      const source = createReadStream(path, { start, end });
      if (request.releaseReadLock) { request.streamingRelease = true; source.once('close', request.releaseReadLock); }
      body = Readable.toWeb(source);
    }
    request.result = new Response(body, { status: range ? 206 : 200, headers });
  }
  async dispatch(physical, method, path, body, upload = false) {
    try {
      if (typeof path !== 'string' || !path.startsWith('/api/') || path.startsWith('//')) throw error('INVALID_PATH', 'Expected a YouDub API path.', 400);
      const url = new URL(path, 'http://youdub.local');
      this.assertReady?.(url.pathname);
      const route = this.routes.find(route => route.method === method && route.pattern.test(url.pathname));
      if (!route) throw error('NOT_FOUND', `Unknown YouDub route: ${method} ${url.pathname}`, 404);
      const match = route.pattern.exec(url.pathname);
      const raw = upload && physical.body ? Readable.fromWeb(physical.body) : Readable.from([]);
      raw.headers = Object.fromEntries(physical.headers); raw.method = method;
      const request = { url, body, raw, physical, params: Object.fromEntries(route.names.map((name, index) => [name, decodeURIComponent(match[index + 1])])), state: { session: true } };
      // Only the legacy task-log handler uses this tiny response shape.
      request.response = { writeHead(status, headers) { request.responseStatus = status; request.responseHeaders = headers; }, end(value) { request.result = new Response(value, { status: request.responseStatus ?? 200, headers: request.responseHeaders }); } };
      await route.handler(request);
      if (!request.result) throw error('RESPONSE_MISSING', `YouDub route produced no response: ${method} ${url.pathname}`, 500);
      return request.result;
    } catch (cause) {
      this.ctx.logger.error(cause);
      return Response.json({ error: { code: cause.code ?? 'INTERNAL_ERROR', message: cause.message, ...(cause.details ? { details: cause.details } : {}) } }, { status: cause.status ?? 500 });
    }
  }
  mount() {
    for (const [path, methods, requestBody, fetch] of [
      ['/api/youdub/v2', ['POST'], 'buffered', async request => { let value; try { value = await request.json(); } catch (cause) { return Response.json({ error: { code: 'INVALID_JSON', message: cause.message } }, { status: 400 }); } return this.dispatch(request, value?.method, value?.path, value?.body); }],
      ['/api/youdub/upload', ['POST'], 'streaming', request => this.dispatch(request, 'POST', '/api/v2/tasks', undefined, true)],
      ['/api/youdub/file', ['GET', 'HEAD'], 'buffered', request => this.dispatch(request, 'GET', new URL(request.url).searchParams.get('path'))],
    ]) this.ctx.effect(() => this.ctx.connection.fetch.register({ path, methods, requestBody, fetch }));
  }
}
