import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context, Service } from 'cordis'
import { mkdtemp, mkdir, readFile, writeFile, rm, cp, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import Extensions from '../src/extensions.js'
import Catalog from '../src/catalog.js'
import Processes from '../src/process.js'

test('independent local package installs, activates after restart, converts a real file, and unregisters', async t => {
  const root = await mkdtemp(join(tmpdir(), 'youdub-extension-'))
  const ctx = new Context()
  const processes = await ctx.plugin(Processes)
  const tasks = await ctx.plugin({ apply(context) { context.reflect.provide('tasks', { idle: async () => true }) } })
  const catalog = await ctx.plugin(Catalog)
  let extensions = await ctx.plugin(Extensions, { root, repoRoot: process.cwd() })
  t.after(async () => { await extensions.dispose(); await catalog.dispose(); await tasks.dispose(); await processes.dispose(); await rm(root, { recursive: true }) })
  const installed = await ctx.extensions.install({ source: resolve('fixtures/plugins/file-transform') })
  assert.equal(installed.id, 'example.file-transform')
  assert.equal(installed.active, false)
  assert.deepEqual(ctx.extensions.hostEntries(), [])
  await extensions.dispose()
  extensions = await ctx.plugin(Extensions, { root, repoRoot: process.cwd() })
  const entry = ctx.extensions.hostEntries()[0]!
  const module = await import(entry.name)
  const plugin = await ctx.plugin(module, entry.config)
  ctx.extensions.markActive(entry.id)
  assert.equal(ctx.catalog.describe().workflows[0]?.id, 'example.uppercase')
  assert.equal(ctx.extensions.clientManifest(false).modules.length, 0)
  assert.equal(ctx.extensions.clientManifest(true).modules[0]?.id, 'example.file-transform')
  const input = join(root, 'input.txt'), workDir = join(root, 'work')
  await writeFile(input, 'hello YouDub\n'); await mkdir(workDir)
  let output: any
  const provider = ctx.catalog.provider('example.text-transform')
  const result = await provider.execute({ workDir, inputs: { document: { id: 'input', schemaId: 'file/v1' } } } as any, {
    signal: new AbortController().signal, resolve: async () => input, progress: async () => {},
    register: async (descriptor: any) => { output = descriptor; return { id: 'output', schemaId: descriptor.schemaId } },
  } as any)
  assert.equal(result.state, 'completed')
  assert.equal(await readFile(join(workDir, output.path), 'utf8'), 'HELLO YOUDUB\n')
  await ctx.extensions.setEnabled(entry.id, false)
  assert.equal(ctx.extensions.list().items[0]?.restartRequired, true)
  assert.equal(ctx.catalog.describe().workflows.length, 1)
  await plugin.dispose()
  assert.equal(ctx.catalog.describe().workflows.length, 0)
  assert.equal(ctx.catalog.describe().providers.length, 0)
})

test('changed package code fails activation and explicit management can disable it', async t => {
  const root = await mkdtemp(join(tmpdir(), 'youdub-integrity-')), ctx = new Context()
  const processes = await ctx.plugin(Processes)
  const tasks = await ctx.plugin({ apply(context) { context.reflect.provide('tasks', { idle: async () => true }) } })
  let extensions = await ctx.plugin(Extensions, { root, repoRoot: process.cwd() })
  t.after(async () => { await extensions.dispose(); await tasks.dispose(); await processes.dispose(); await rm(root, { recursive: true }) })
  await ctx.extensions.install({ source: resolve('fixtures/plugins/file-transform') })
  await extensions.dispose()
  const [installed] = JSON.parse(await readFile(join(root, 'installed.json'), 'utf8'))
  await writeFile(join(installed.directory, 'dist/host.js'), '// modified after installation\n')
  const damaged = ctx.plugin(Extensions, { root, repoRoot: process.cwd() })
  await assert.rejects(Promise.resolve(damaged), (error: any) => error.code === 'PLUGIN_INTEGRITY_MISMATCH')
  await damaged.dispose()
  extensions = await ctx.plugin(Extensions, { root, repoRoot: process.cwd(), managementOnly: true })
  assert.deepEqual(ctx.extensions.hostEntries(), [])
  await assert.rejects(ctx.extensions.setEnabled('example.file-transform', true), (error: any) => error.code === 'PLUGIN_INTEGRITY_MISMATCH')
  await ctx.extensions.setEnabled('example.file-transform', false)
  assert.equal(ctx.extensions.list().items[0]?.enabled, false)
})

test('npm build uses shared Host modules and its provider loads after restart', async t => {
  const root = await mkdtemp(join(tmpdir(), 'youdub-build-')), source = join(root, 'source'), installedRoot = join(root, 'installed'), ctx = new Context()
  await mkdir(source)
  await writeFile(join(source, 'package.json'), JSON.stringify({ name: 'youdub-build-example', version: '1.0.0', type: 'module',
    peerDependencies: { cordis: '4.0.0-rc.10', '@youdub/sdk': '^1.0.0' }, scripts: { build: 'node build.mjs' },
    youdub: { id: 'example.build', sdkVersion: '1.0.0', host: 'dist/host.mjs', build: 'npm' } }))
  const code = `import { Service } from 'cordis'; import { SDK_VERSION } from '@youdub/sdk';
export const sharedService = Service; export const sdkVersion = SDK_VERSION; export const inject = ['catalog'];
export function apply(ctx, config) { ctx.effect(() => ctx.catalog.registerProvider({ id: 'example.build', describe: () => ({ id: 'example.build', ...config.$plugin, operations: [] }), probe: async () => ({}), execute: async () => ({state:'completed', outputs:{}}) })); }`
  await writeFile(join(source, 'build.mjs'), `import { Service } from 'cordis'; import { mkdir,writeFile } from 'node:fs/promises'; if(!Service) throw new Error('missing Cordis'); import.meta.resolve('@youdub/sdk'); await mkdir('dist'); await writeFile('dist/host.mjs', ${JSON.stringify(code)});`)
  const processes = await ctx.plugin(Processes)
  const tasks = await ctx.plugin({ apply(context) { context.reflect.provide('tasks', { idle: async () => true }) } })
  const catalog = await ctx.plugin(Catalog)
  let extensions = await ctx.plugin(Extensions, { root: installedRoot, repoRoot: process.cwd() })
  t.after(async () => { await extensions.dispose(); await catalog.dispose(); await tasks.dispose(); await processes.dispose(); await rm(root, { recursive: true }) })
  await ctx.extensions.install({ source })
  const [installed] = JSON.parse(await readFile(join(installedRoot, 'installed.json'), 'utf8'))
  assert.equal(await realpath(join(installed.directory, 'node_modules/cordis')), await realpath(resolve('node_modules/cordis')))
  assert.equal(await realpath(join(installed.directory, 'node_modules/@youdub/sdk')), await realpath(resolve('packages/sdk')))
  const log = await readFile(join(installed.directory, '../install.log'), 'utf8')
  assert.equal((log.match(/\$ npm install /g) || []).length, 1)
  await extensions.dispose()
  extensions = await ctx.plugin(Extensions, { root: installedRoot, repoRoot: process.cwd() })
  const entry = ctx.extensions.hostEntries()[0]!, module = await import(entry.name)
  assert.equal(module.sharedService, Service)
  assert.equal(module.sdkVersion, '1.0.0')
  const plugin = await ctx.plugin(module, entry.config)
  assert.equal(ctx.catalog.provider('example.build').id, 'example.build')
  await plugin.dispose()
})

test('a build that introduces a second Cordis in its dependency tree fails installation', async t => {
  const root = await mkdtemp(join(tmpdir(), 'youdub-build-identity-')), source = join(root, 'source'), installedRoot = join(root, 'installed'), ctx = new Context()
  await mkdir(source)
  await writeFile(join(source, 'package.json'), JSON.stringify({ name: 'youdub-build-conflict', version: '1.0.0', type: 'module', scripts: { build: 'node build.mjs' },
    youdub: { id: 'example.build-conflict', sdkVersion: '1.0.0', host: 'host.mjs', build: 'npm' } }))
  await writeFile(join(source, 'build.mjs'), "import {mkdir,writeFile} from 'node:fs/promises'; await mkdir('node_modules/helper/node_modules/cordis',{recursive:true}); await writeFile('host.mjs','export function apply() {}');")
  const processes = await ctx.plugin(Processes)
  const tasks = await ctx.plugin({ apply(context) { context.reflect.provide('tasks', { idle: async () => true }) } })
  const extensions = await ctx.plugin(Extensions, { root: installedRoot, repoRoot: process.cwd() })
  t.after(async () => { await extensions.dispose(); await tasks.dispose(); await processes.dispose(); await rm(root, { recursive: true }) })
  await assert.rejects(ctx.extensions.install({ source }), (error: any) => error.code === 'INCOMPATIBLE_PLUGIN' && /own cordis/.test(error.message))
  assert.deepEqual(ctx.extensions.list().items, [])
})

test('Python entry can import its own helper without changing installed integrity', async t => {
  const root = await mkdtemp(join(tmpdir(), 'youdub-python-import-')), source = join(root, 'source'), installedRoot = join(root, 'installed'), ctx = new Context()
  await cp(resolve('fixtures/plugins/python-text'), source, { recursive: true })
  const worker = await readFile(join(source, 'worker.py'), 'utf8')
  await writeFile(join(source, 'worker.py'), worker.replace('import json', 'import json\nfrom helper import transform').replace('source.read_text(encoding="utf-8").upper()', 'transform(source.read_text(encoding="utf-8"))'))
  await writeFile(join(source, 'helper.py'), 'def transform(value):\n    return value.upper()\n')
  const processes = await ctx.plugin(Processes)
  const support = await ctx.plugin({ apply(context) {
    context.reflect.provide('tasks', { idle: async () => true })
    context.reflect.provide('store', { call: async () => { throw new Error('Independent Python provider must not use the storage bridge.') } })
  } })
  const catalog = await ctx.plugin(Catalog)
  let extensions = await ctx.plugin(Extensions, { root: installedRoot, repoRoot: process.cwd() })
  t.after(async () => { await extensions.dispose(); await catalog.dispose(); await support.dispose(); await processes.dispose(); await rm(root, { recursive: true }) })
  await ctx.extensions.install({ source })
  await extensions.dispose()
  extensions = await ctx.plugin(Extensions, { root: installedRoot, repoRoot: process.cwd() })
  const entry = ctx.extensions.hostEntries()[0]!, plugin = await ctx.plugin(await import(entry.name), entry.config)
  const input = join(root, 'input.txt'), workDir = join(root, 'work')
  await writeFile(input, 'hello from helper\n'); await mkdir(workDir)
  const result = await ctx.catalog.provider('example.python-uppercase').execute({ invocationId: 'python-helper', taskId: 'helper-task', attempt: 1, stepId: 'uppercase', operation: 'example.uppercase/v1', binding: { options: {} }, inputs: { document: { id: 'input', schemaId: 'file/v1' } }, workDir, taskDir: root, config: {} } as any, {
    signal: new AbortController().signal, credentials: {}, resolve: async () => input,
    register: async (descriptor: any) => { assert.equal(await readFile(join(workDir, descriptor.path), 'utf8'), 'HELLO FROM HELPER\n'); return { id: 'output', schemaId: descriptor.schemaId } },
  } as any)
  assert.equal(result.state, 'completed')
  await plugin.dispose(); await extensions.dispose()
  extensions = await ctx.plugin(Extensions, { root: installedRoot, repoRoot: process.cwd() })
  assert.equal(ctx.extensions.hostEntries()[0]?.id, 'example.python-text')
})
