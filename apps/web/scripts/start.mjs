import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'

// The production Host serves the built shell and API from one origin.
const root = fileURLToPath(new URL('../../../', import.meta.url))
process.chdir(root)
config({ path: resolve('.env'), quiet: true })
process.env.YOUDUB_WEB_ROOT = resolve('apps/web/dist')
process.env.YOUDUB_PORT ||= '3000'
const { register } = await import('tsx/esm/api')
register()
await import('../../../apps/host/src/main.ts')
