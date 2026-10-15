import { spawn, spawnSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { demos } from '../site/demos.js'

const app = resolve(process.argv[2] || 'dist/YouDub.app')
function verify() {
  const result = spawnSync('codesign', ['--verify', '--deep', '--strict', app], { encoding: 'utf8' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`Application signature failed: ${result.stderr}`)
}
verify()
const data = await mkdtemp(join(tmpdir(), 'youdub-release-smoke-'))
const resources = join(app, 'Contents/Resources')
// Exercise the actual extension install/build path with only bundled Node/npm.
const extension = spawnSync(join(resources, 'node'), ['--import', 'tsx', '--input-type=module', '-e', `
  import { Context } from 'cordis'
  import { mkdir, writeFile, readFile } from 'node:fs/promises'
  import { join } from 'node:path'
  import Extensions from './packages/builtin/src/extensions.ts'
  import Processes from './packages/builtin/src/process.ts'
  const source = join(process.env.YOUDUB_SMOKE_DATA, 'extension-source')
  await mkdir(source)
  await writeFile(join(source, 'package.json'), JSON.stringify({name:'example-bundled-build',version:'1.0.0',type:'module',scripts:{build:'node build.mjs'},youdub:{id:'example.bundled-build',sdkVersion:'1.0.0',host:'host.mjs',build:'npm'}}))
  await writeFile(join(source, 'build.mjs'), 'import {AppError} from "@youdub/sdk"; import {writeFileSync} from "node:fs"; if (!(new AppError("TEST","test") instanceof Error)) throw Error("SDK failed"); writeFileSync("host.mjs", "export function apply() {}")')
  const ctx = new Context()
  const processes = await ctx.plugin(Processes)
  const tasks = await ctx.plugin({apply(c) {c.reflect.provide('tasks', {idle: async () => true})}})
  const extensions = await ctx.plugin(Extensions, {root:join(process.env.YOUDUB_SMOKE_DATA,'extensions'),repoRoot:process.cwd()})
  try {
    const installed = await ctx.extensions.install({source})
    if (installed.id !== 'example.bundled-build') throw Error('Extension did not install')
  } finally { await extensions.dispose(); await tasks.dispose(); await processes.dispose() }
`], {
  cwd: join(resources, 'runtime'), encoding: 'utf8',
  env: { ...process.env, PATH: `${resources}:/usr/bin:/bin:/usr/sbin:/sbin`, npm_execpath: join(resources, 'node_modules/npm/bin/npm-cli.js'), YOUDUB_SMOKE_DATA: data },
})
if (extension.error) throw extension.error
if (extension.status !== 0) throw new Error(`Bundled extension build failed: ${extension.stdout}\n${extension.stderr}`)
const server = spawn(join(resources, 'node'), ['--expose-internals', '--import', 'tsx', 'apps/desktop/server.mjs'], {
  cwd: join(resources, 'runtime'),
  env: { ...process.env, YOUDUB_DESKTOP_DATA_DIR: data },
  stdio: ['pipe', 'pipe', 'pipe'],
})
let diagnostics = ''
server.stderr.on('data', chunk => { diagnostics += chunk })
const exited = new Promise((resolve, reject) => { server.once('exit', (code, signal) => resolve({ code, signal })); server.once('error', reject) })
try {
  const base = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Desktop startup timed out.\n${diagnostics}`)), 60000)
    let output = ''
    server.stdout.on('data', chunk => {
      output += chunk
      const match = output.match(/YOUDUB_READY=(http:\/\/127\.0\.0\.1:\d+)/)
      if (match) { clearTimeout(timer); resolve(match[1]) }
    })
    exited.then(result => { clearTimeout(timer); reject(new Error(`Desktop exited during startup: ${JSON.stringify(result)}\n${diagnostics}`)) }, reject)
  })
  for (const path of ['/', '/favicon.ico', '/icon.svg', '/tasks', '/settings', '/api/setup', '/examples/index.html', '/examples/player.js', '/examples/demos.js',
    ...Object.keys(demos).flatMap(id => [`/examples/assets/${id}-en.mp4`, `/examples/assets/${id}-zh.mp4`, `/examples/assets/${id}-poster.jpg`])]) {
    const response = await fetch(base + path, { signal: AbortSignal.timeout(10000) })
    if (!response.ok) throw new Error(`Desktop ${path}: HTTP ${response.status}`)
    await response.arrayBuffer()
  }
  verify()
  console.log('Desktop routes and icons respond; signed application remains unchanged.')
} finally {
  server.stdin.end()
  const timer = setTimeout(() => { console.error('Desktop shutdown timed out; terminating smoke process.'); server.kill('SIGKILL') }, 30000)
  const result = await exited
  clearTimeout(timer)
  if (result.code !== 0) throw new Error(`Desktop shutdown failed: ${JSON.stringify(result)}\n${diagnostics}`)
  await rm(data, { recursive: true })
}
verify()
