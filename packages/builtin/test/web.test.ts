import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from 'cordis'
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Http from '../src/http.js'
import * as Web from '../src/web.js'

test('built SPA supports direct node URLs, static media and API routing before Python is ready', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'youdub-web-'))
  const root = join(directory, 'dist')
  await mkdir(join(root, 'assets'), { recursive: true })
  await writeFile(join(root, 'index.html'), '<html><div id="root"></div></html>')
  await writeFile(join(root, 'assets/app.js'), 'export const loaded = true')
  await writeFile(join(root, 'assets/theme.css'), 'body{color:red}')
  await writeFile(join(root, 'clip.mp4'), '0123456789')
  await writeFile(join(root, '.env'), 'PRIVATE=hidden')
  const ctx = new Context()
  const host = await ctx.plugin(async function application(scope) {
    await scope.plugin(Http, { host: '127.0.0.1', port: 0 })
    await scope.plugin(Web, { root })
    await scope.plugin({ inject: ['http'], apply(owner) {
      owner.effect(() => owner.http.register('GET', '/api/setup', request => owner.http.json(request, 200, { phase: 'error', error: 'Python missing' })))
    } })
  })
  t.after(async () => { await host.dispose(); await rm(directory, { recursive: true }) })
  assert.equal(host.state, 2)
  ctx.emit('app/ready')
  const base = ctx.http.address!
  for (const route of ['/', '/tasks', '/settings', '/workflows/youdub.subtitles', '/tasks/task-id/nodes/review']) {
    const response = await fetch(base + route, { headers: { Accept: 'text/html' } })
    assert.equal(response.status, 200)
    assert.match(response.headers.get('content-type')!, /^text\/html/)
    assert.match(await response.text(), /id="root"/)
  }
  for (const route of ['/tasks', '/settings']) {
    assert.equal((await fetch(base + route)).status, 404, 'SPA fallback requires a document navigation Accept header')
  }
  assert.deepEqual(await (await fetch(base + '/api/setup')).json(), { phase: 'error', error: 'Python missing' })
  for (const route of ['/api/missing', '/assets/missing.js', '/plugin-platform/missing.mjs', '/missing.png', '/.env', '/%2eenv']) {
    assert.equal((await fetch(base + route, { headers: { Accept: 'text/html' } })).status, 404, route)
  }
  for (const [path, type] of [['app.js', 'text/javascript'], ['theme.css', 'text/css']]) {
    const response = await fetch(base + '/assets/' + path)
    assert.equal(response.status, 200)
    assert.ok(response.headers.get('content-type')?.startsWith(type))
    assert.ok((await response.text()).length)
  }
  const range = await fetch(base + '/clip.mp4', { headers: { Range: 'bytes=2-5' } })
  assert.equal(range.status, 206); assert.equal(await range.text(), '2345')
  const head = await fetch(base + '/', { method: 'HEAD' })
  assert.equal(head.status, 200); assert.equal(await head.text(), '')
  assert.equal((await fetch(base + '/', { method: 'POST' })).status, 404)
  if (process.platform !== 'win32') {
    const outside = join(directory, 'outside.txt')
    await writeFile(outside, 'private')
    await symlink(outside, join(root, 'escape.txt'))
    assert.equal((await fetch(base + '/escape.txt')).status, 404)
  }
})
