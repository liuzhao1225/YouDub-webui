import { cp, mkdir, readFile, writeFile, access } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { basename, dirname, join } from 'node:path'
import { transform } from 'esbuild'

export const nodeVersion = '22.23.2'
export function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', windowsHide: true, ...options })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} failed (${result.status}).`)
}
export function runNpm(args, options) {
  const npm = process.env.npm_execpath || join(dirname(process.execPath), process.platform === 'win32' ? 'node_modules/npm/bin/npm-cli.js' : '../lib/node_modules/npm/bin/npm-cli.js')
  run(process.execPath, [npm, ...args], options)
}

export async function assembleRuntime(root, runtime) {
  await mkdir(runtime, { recursive: true })
  const filter = file => !['.git', '__pycache__', '.venv', 'node_modules', '.pytest_cache', '.DS_Store', 'env.txt'].includes(basename(file)) && !basename(file).startsWith('.env')
  for (const file of ['package.json', 'package-lock.json', 'tsconfig.json', 'youdub.config.ts', 'requirements.txt', 'LICENSE', 'apps/host', 'packages/sdk', 'packages/builtin', 'backend/app', 'backend/workers', 'submodule/demucs', 'apps/desktop/server.mjs', 'apps/web/plugin-dist']) {
    await cp(join(root, file), join(runtime, file), { recursive: true, filter })
  }
  await access(join(runtime, 'submodule/demucs/demucs/__init__.py'))
  runNpm(['ci', '--ignore-scripts', '--no-audit', '--no-fund', '--registry=https://registry.npmmirror.com'], { cwd: runtime })
  // Extension build scripts run in plain Node, without the host's tsx loader.
  const sdk = join(runtime, 'packages/sdk')
  const manifest = JSON.parse(await readFile(join(sdk, 'package.json'), 'utf8'))
  for (const [name, source] of Object.entries(manifest.exports)) {
    const output = source.replace(/\.ts$/, '.js')
    const result = await transform(await readFile(join(sdk, source), 'utf8'), { loader: 'ts', format: 'esm', target: 'node22' })
    await writeFile(join(sdk, output), result.code)
    manifest.exports[name] = { types: source, default: output }
  }
  await writeFile(join(sdk, 'package.json'), JSON.stringify(manifest) + '\n')
  await cp(join(root, 'apps/web/.next-desktop/standalone'), join(runtime, 'web'), { recursive: true, dereference: true, filter: file => !basename(file).startsWith('.env') && basename(file) !== 'env.txt' })
  await cp(join(root, 'apps/web/.next-desktop/static'), join(runtime, 'web/apps/web/.next-desktop/static'), { recursive: true })
  await cp(join(root, 'apps/web/public'), join(runtime, 'web/apps/web/public'), { recursive: true })
  await access(join(runtime, 'web/apps/web/server.js'))
}

export async function bundleNode(distribution, resources) {
  const windows = process.platform === 'win32'
  const node = join(resources, windows ? 'node.exe' : 'node')
  await cp(join(distribution, windows ? 'node.exe' : 'bin/node'), node)
  await cp(join(distribution, windows ? 'node_modules/npm' : 'lib/node_modules/npm'), join(resources, 'node_modules/npm'), { recursive: true })
  await cp(join(distribution, 'LICENSE'), join(resources, 'NODE-LICENSE.txt'))
  run(node, [join(resources, 'node_modules/npm/bin/npm-cli.js'), '--version'])
  run(node, ['--input-type=module', '-e', 'import { SDK_VERSION, AppError } from "@youdub/sdk"; if (SDK_VERSION !== "1.0.0" || !(new AppError("TEST", "test") instanceof Error)) process.exit(1)'], { cwd: join(resources, 'runtime') })
  run(node, ['-e', 'require.resolve("next")'], { cwd: join(resources, 'runtime/web/apps/web') })
}
