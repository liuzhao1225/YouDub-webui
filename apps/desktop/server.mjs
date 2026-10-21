import { config } from 'dotenv'
import { dirname, join } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { startHost } from '../host/src/bootstrap.ts'
import composition from '../../youdub.config.ts'
import { ModuleLoader } from '@cordisjs/plugin-loader'

if (process.platform !== 'win32') process.umask(0o077)
const data = process.env.YOUDUB_DESKTOP_DATA_DIR
if (!data) throw new Error('YOUDUB_DESKTOP_DATA_DIR is required by the desktop launcher.')
await mkdir(data, { recursive: true })
config({ path: join(data, '.env'), quiet: true })
process.env.YOUDUB_HOST = '127.0.0.1'
process.env.YOUDUB_PORT = '0'
process.env.YOUDUB_WEB_ROOT = join(process.cwd(), 'apps/web/dist')
process.env.YOUDUB_PYTHON_ENV_DIR = join(data, 'runtime', 'venv')
process.env.PYTHONDONTWRITEBYTECODE = '1'
process.env.npm_execpath = join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')
// Resolve through the bundled Node loader without writing .cordis into the signed app.
if (!ModuleLoader.fromInternal()) throw new Error('The bundled Node module loader is unavailable.')

let host, closing = false
async function stop(code = 0) {
  if (closing) return
  closing = true
  try {
    await host?.stop()
  } catch (error) { console.error(error); code = 1 }
  process.exit(code)
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => void stop())
process.stdin.resume()
process.stdin.once('end', () => void stop())

try {
  host = await startHost(await composition(), new URL('../../', import.meta.url).href)
  if (!host.ctx.http.address) throw new Error('Desktop HTTP server has no listening address.')
  console.log(`YOUDUB_READY=${host.ctx.http.address}`)
} catch (error) { console.error(error); await stop(1) }
