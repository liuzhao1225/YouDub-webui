import { resolve } from 'node:path';

// Keep one local input for trying workflows without downloading a source video.
export function registerExampleRoutes(ctx, transport, root) {
  ctx.effect(() => ctx.connection.fetch.register({
    path: '/api/youdub/examples/assets/jensen-en.mp4', methods: ['GET', 'HEAD'], requestBody: 'buffered', async fetch(physical) {
      try {
        const request = { physical };
        await transport.file(request, resolve(root, 'site/assets/jensen-en.mp4'), { mime: 'video/mp4' });
        return request.result;
      } catch (cause) {
        ctx.logger.error(cause);
        return Response.json({ error: { code: cause.code ?? 'ASSET_ERROR', message: cause.message } }, { status: cause.code === 'ENOENT' ? 404 : 500 });
      }
    },
  }));
}
