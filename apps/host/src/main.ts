import { config } from 'dotenv'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { readFile } from 'node:fs/promises'
import { startHost } from './bootstrap.js'

if (process.platform !== 'win32') process.umask(0o077)
config({ path: resolve('.env'), quiet: true })
const configPath = resolve(process.env.YOUDUB_CONFIG || 'youdub.config.ts')
const entries = configPath.endsWith('.json') ? JSON.parse(await readFile(configPath, 'utf8')) : await (await import(pathToFileURL(configPath).href)).default()
const host = await startHost(entries, pathToFileURL(resolve('.') + '/').href)
console.log('YouDub Cordis host ready.')
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => {
  void host.stop().then(() => { process.exitCode = 0 }, error => { console.error(error); process.exitCode = 1 })
})
