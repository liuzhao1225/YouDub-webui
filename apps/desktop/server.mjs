import { config } from 'dotenv'
import { createServer, request } from 'node:http'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { join } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { startHost } from '../host/src/bootstrap.ts'
import composition from '../../youdub.config.ts'
import { ModuleLoader } from '@cordisjs/plugin-loader'

process.umask(0o077)
const data = process.env.YOUDUB_DESKTOP_DATA_DIR
if (!data) throw new Error('YOUDUB_DESKTOP_DATA_DIR is required by the desktop launcher.')
await mkdir(data, { recursive: true })
config({ path: join(data, '.env'), quiet: true })
process.env.YOUDUB_HOST = '127.0.0.1'
process.env.YOUDUB_PORT = '0'
process.env.YOUDUB_PYTHON_ENV_DIR = join(data, 'runtime', 'venv')
process.env.PYTHONDONTWRITEBYTECODE = '1'
// Resolve through the bundled Node loader without writing .cordis into the signed app.
if (!ModuleLoader.fromInternal()) throw new Error('The bundled Node module loader is unavailable.')

let host, web, gateway, closing = false
async function stop(code = 0) {
  if (closing) return
  closing = true
  try {
    gateway?.closeAllConnections()
    if (gateway?.listening) await new Promise((resolve, reject) => gateway.close(error => error ? reject(error) : resolve()))
    const webExit = web && web.exitCode === null && web.signalCode === null ? once(web, 'exit') : undefined
    if (webExit) web.kill('SIGTERM')
    await host?.stop()
    if (webExit) await webExit
  } catch (error) { console.error(error); code = 1 }
  process.exit(code)
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => void stop())
process.stdin.resume()
process.stdin.once('end', () => void stop())

try {
  host = await startHost(await composition(), new URL('../../', import.meta.url).href)
  // Ask the OS for a free port before starting Next. A bind failure is surfaced.
  const reservation = createServer()
  reservation.listen(0, '127.0.0.1')
  await once(reservation, 'listening')
  const port = reservation.address().port
  await new Promise(resolve => reservation.close(resolve))
  const webURL = `http://127.0.0.1:${port}`
  web = spawn(process.execPath, [join(process.cwd(), 'web/apps/web/server.js')], {
    env: { ...process.env, NODE_ENV: 'production', HOSTNAME: '127.0.0.1', PORT: String(port), NEXT_TELEMETRY_DISABLED: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  web.stdout.pipe(process.stderr)
  web.stderr.pipe(process.stderr)
  let webFailure
  web.on('error', error => { webFailure = error; console.error(error); void stop(1) })
  web.on('exit', (code, signal) => {
    if (!closing) { webFailure = new Error(`Web server exited (${code ?? signal}).`); console.error(webFailure); void stop(1) }
  })
  const deadline = Date.now() + 60_000
  while (true) {
    if (webFailure) throw webFailure
    if (Date.now() >= deadline) throw new Error('Web server did not become ready within 60 seconds.')
    try {
      const response = await fetch(webURL, { signal: AbortSignal.timeout(5000) })
      await response.arrayBuffer()
      if (!response.ok) throw new Error(`Web startup returned HTTP ${response.status}.`)
      break
    } catch (error) {
      if (error.cause?.code !== 'ECONNREFUSED') throw error
      await delay(100)
    }
  }
  gateway = createServer((incoming, outgoing) => {
    const target = new URL(incoming.url, incoming.url.startsWith('/api/') ? host.ctx.http.address : webURL)
    const upstream = request(target, { method: incoming.method, headers: { ...incoming.headers, host: target.host } }, response => {
      outgoing.writeHead(response.statusCode, response.headers)
      response.pipe(outgoing)
      response.on('error', error => { console.error(error); outgoing.destroy(error) })
    })
    upstream.on('error', error => {
      console.error(error)
      if (outgoing.headersSent) outgoing.destroy(error)
      else { outgoing.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' }); outgoing.end('本地服务连接失败，请查看应用日志。') }
    })
    outgoing.on('close', () => upstream.destroy())
    incoming.pipe(upstream)
  })
  gateway.requestTimeout = 0
  gateway.listen(0, '127.0.0.1')
  await once(gateway, 'listening')
  console.log(`YOUDUB_READY=http://127.0.0.1:${gateway.address().port}`)
} catch (error) { console.error(error); await stop(1) }
