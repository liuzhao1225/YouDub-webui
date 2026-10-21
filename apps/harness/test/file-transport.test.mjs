import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { YouDubTransport, fileURL } from '../src/backend/transport.mjs';

test('fixed file endpoint preserves output names for native save, preview and Range', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'youdub-file-'));
  const path = join(folder, 'source.srt'), bytes = Buffer.from('1\n00:00:01,000 --> 00:00:02,000\n字幕\n');
  await writeFile(path, bytes);
  const handlers = new Map(), transport = new YouDubTransport({ effect: fn => fn(), logger: { error: cause => { throw cause; } }, connection: { fetch: { register: route => handlers.set(route.path, route) } } });
  transport.mount();
  transport.register('GET', '/api/v2/output', request => transport.file(request, path, {
    mime: 'application/x-subrip', name: request.url.searchParams.get('name') || 'source.srt', download: request.url.searchParams.get('download') === 'true',
  }));
  const fetchFile = (query = '', init = {}) => handlers.get('/api/youdub/file').fetch(new Request('http://localhost' + fileURL('/api/v2/output' + query), init));
  try {
    const preview = await fetchFile();
    assert.equal(preview.headers.get('content-disposition'), 'inline; filename="source.srt"; filename*=UTF-8\'\'source.srt');
    assert.deepEqual(Buffer.from(await preview.arrayBuffer()), bytes);
    const ranged = await fetchFile('', { headers: { range: 'bytes=0-7' } });
    assert.equal(ranged.status, 206);
    assert.equal(ranged.headers.get('content-range'), `bytes 0-7/${bytes.length}`);
    assert.match(ranged.headers.get('content-disposition'), /filename="source.srt"/);
    assert.deepEqual(Buffer.from(await ranged.arrayBuffer()), bytes.subarray(0, 8));
    const named = await fetchFile('?download=true&name=' + encodeURIComponent('原文 字幕.srt'), { method: 'HEAD' });
    assert.equal(named.headers.get('content-disposition'), `attachment; filename="__ __.srt"; filename*=UTF-8''${encodeURIComponent('原文 字幕.srt')}`);
    assert.equal(await named.text(), '');
  } finally { await rm(folder, { recursive: true, force: true }); }
});
