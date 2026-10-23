import { resolve } from 'node:path';

// The original examples page and player are served byte-for-byte. Harness owns
// these exact owner-authenticated paths, including video Range requests.
export function registerExampleRoutes(ctx, transport, root) {
  const files = [
    ['index.html', 'apps/web/templates/examples.html', 'text/html; charset=utf-8'],
    ['style.css', 'site/style.css', 'text/css; charset=utf-8'],
    ['player.js', 'site/player.js', 'text/javascript; charset=utf-8'],
    ['demos.js', 'site/demos.js', 'text/javascript; charset=utf-8'],
    ...['youdub-logo.svg', 'youdub-icon.svg'].map(name => [`assets/${name}`, `site/assets/${name}`, 'image/svg+xml']),
    ...['jensen', 'creator', 'zoo'].flatMap(id => [
      ...['en', 'zh'].map(language => [`assets/${id}-${language}.mp4`, `site/assets/${id}-${language}.mp4`, 'video/mp4']),
      [`assets/${id}-poster.jpg`, `site/assets/${id}-poster.jpg`, 'image/jpeg'],
    ]),
  ];
  for (const [path, source, mime] of files) ctx.effect(() => ctx.connection.fetch.register({
    path: `/api/youdub/examples/${path}`, methods: ['GET', 'HEAD'], requestBody: 'buffered', async fetch(physical) {
      try {
        const request = { physical };
        await transport.file(request, resolve(root, source), { mime });
        return request.result;
      } catch (cause) {
        ctx.logger.error(cause);
        return Response.json({ error: { code: cause.code ?? 'ASSET_ERROR', message: cause.message } }, { status: cause.code === 'ENOENT' ? 404 : 500 });
      }
    },
  }));
}
