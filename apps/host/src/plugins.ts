import { config as loadEnv } from 'dotenv'
import { resolve, join } from 'node:path'
import { homedir } from 'node:os'
import { pathToFileURL } from 'node:url'
import type { EntryOptions } from '@cordisjs/plugin-loader'
import { startHost } from './bootstrap.js'
import '../../../packages/builtin/src/extensions.js'

if (process.platform !== 'win32') process.umask(0o077)
loadEnv({ path: resolve('.env'), quiet: true })
const [command = 'help', ...args] = process.argv.slice(2)
const options = new Map<string, string>()
for (let index = 0; index < args.length; index += 2) {
  if (!args[index]?.startsWith('--') || !args[index + 1] || args[index + 1]!.startsWith('--')) throw new Error('Use named options such as --source <directory> and --ref <commit>.')
  options.set(args[index]!.slice(2), args[index + 1]!)
}
if (command === 'help') {
  console.log('YouDub plugins\n  list [--data-dir DIR]\n  install --source PATH|npm:NAME@VERSION|https://github.com/OWNER/REPO [--ref REF]\n  enable --id PLUGIN_ID\n  disable --id PLUGIN_ID\nChanges apply after the application restarts. Removal is available in Settings after disabling and restarting.')
} else {
  if (!['list', 'install', 'enable', 'disable'].includes(command)) throw new Error(`Unknown plugin command: ${command}`)
  const repoRoot = resolve('.'), python = resolve(process.env.YOUDUB_PYTHON || '.venv/bin/python')
  const dataBase = process.platform === 'darwin' ? join(homedir(), 'Library/Application Support/YouDub') : process.platform === 'win32' ? join(process.env.LOCALAPPDATA || homedir(), 'YouDub') : join(process.env.XDG_DATA_HOME || join(homedir(), '.local/share'), 'youdub')
  const root = resolve(options.get('data-dir') || process.env.YOUDUB_DESKTOP_DATA_DIR || dataBase)
  const entry = (id: string, config?: object): EntryOptions => ({ id, name: '@youdub/builtin/' + id, config })
  const host = await startHost([
    entry('process'), entry('catalog'), entry('files', { root }), entry('store', { root, repoRoot, python }),
    entry('secrets'), entry('settings'), entry('tasks'), entry('extensions', { root: join(root, 'extensions'), repoRoot, managementOnly: true }),
  ], pathToFileURL(repoRoot + '/').href, { ready: false })
  try {
    if (command === 'list') {
      console.log(JSON.stringify({ items: host.ctx.extensions.list().items.map(({ active, restartRequired, ...item }) => item) }, null, 2))
    } else if (command === 'install') {
      const source = options.get('source')
      if (!source) throw new Error('install requires --source.')
      console.log(JSON.stringify(await host.ctx.extensions.install({ source, ref: options.get('ref') }), null, 2))
    } else {
      const id = options.get('id')
      if (!id) throw new Error(`${command} requires --id.`)
      await host.ctx.extensions.setEnabled(id, command === 'enable')
      console.log(JSON.stringify({ id, enabled: command === 'enable', restartRequired: true }, null, 2))
    }
  } finally { await host.stop() }
}
