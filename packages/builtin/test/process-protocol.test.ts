import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolve, join } from 'node:path'
import { Context } from 'cordis'
import Processes from '../src/process.js'
import type { Invocation, InvocationContext } from '@youdub/sdk'

const invocation = { invocationId: 'protocol-test', taskId: 'task', attempt: 1, stepId: 'step', binding: { options: {} }, inputs: {} } as Invocation
const python = process.env.YOUDUB_TEST_PYTHON || resolve('.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
function worker(script: string) { return { command: process.execPath, args: ['-e', script] } }
function context(override: Partial<InvocationContext> = {}): InvocationContext {
  return { signal: new AbortController().signal, progress: async () => {}, externalPrepare: async () => {}, externalUpdate: async () => {}, register: async () => ({ id: 'artifact', schemaId: 'file/v1' }), resolve: async () => '', credentials: {}, ...override }
}
const receive = `process.stdin.once('data', raw => { const request = JSON.parse(raw.toString()); const send = (type, payload, seq = 1) => process.stdout.write(JSON.stringify({version:'youdub-worker/v1',invocationId:request.invocationId,seq,type,payload})+'\\n'); `

test('unknown RPC message rejects its request instead of abandoning it', async t => {
  const ctx = new Context(), processPlugin = await ctx.plugin(Processes)
  const rpc = await ctx.youdubWorker.rpc(worker(`process.stdin.once('data', raw => {const m=JSON.parse(raw); process.stdout.write(JSON.stringify({version:m.version,requestId:m.requestId,seq:1,type:'unknown',payload:{}})+'\\n');});`))
  t.after(async () => { await rpc.close(); await processPlugin.dispose() })
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await assert.rejects(Promise.race([rpc.call('store.get', { id: 'x' }), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('RPC did not reject unknown message.')), 1000) })]), /Unknown storage message|lost its response/)
  } finally { clearTimeout(timer) }
})

test('malformed worker output stops all subsequent buffered side effects', async t => {
  const ctx = new Context(), plugin = await ctx.plugin(Processes)
  t.after(() => plugin.dispose())
  let prepares = 0, progress = 0
  const script = receive + `process.stdout.write('not-json\\n'); send('external.prepare',{externalRequestId:'x',requestKey:'key'}); send('progress',{value:0.5,message:'should not run'},2); });`
  await assert.rejects(ctx.youdubWorker.worker(worker(script), invocation, context({ externalPrepare: async () => { prepares++ }, progress: async () => { progress++ } })))
  assert.equal(prepares, 0, 'No new external intent may be recorded after protocol failure.')
  assert.equal(progress, 0, 'No progress may be persisted after protocol failure.')
})

test('worker result followed by abnormal exit never registers successful artifacts', async t => {
  const ctx = new Context(), plugin = await ctx.plugin(Processes)
  t.after(() => plugin.dispose())
  let registrations = 0
  const script = receive + `send('result',{state:'completed',outputs:{file:{$artifact:'f'}},artifacts:{f:{path:'x.txt',mimeType:'text/plain',schemaId:'file/v1'}}}); process.exitCode=9; process.stdin.destroy(); });`
  await assert.rejects(ctx.youdubWorker.worker(worker(script), invocation, context({ register: async () => { registrations++; return { id: 'x', schemaId: 'file/v1' } } })), /Worker exited \(9\)/)
  assert.equal(registrations, 0)
})

test('worker cancellation waits for the running process to exit', async t => {
  const ctx = new Context(), plugin = await ctx.plugin(Processes)
  t.after(() => plugin.dispose())
  const controller = new AbortController()
  let entered!: () => void, pid = 0
  const started = new Promise<void>(resolve => { entered = resolve })
  const script = receive + `send('progress',{value:0,message:String(process.pid)}); setInterval(()=>{},1000); });`
  const execution = ctx.youdubWorker.worker(worker(script), invocation, context({ signal: controller.signal, progress: async (_, message) => { pid = Number(message); entered() } }))
  await started
  controller.abort(new Error('cancelled by test'))
  await assert.rejects(execution)
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' })
})

test('Windows cancellation also stops a worker child process', { timeout: 15000, skip: process.platform !== 'win32' }, async t => {
  const ctx = new Context(), plugin = await ctx.plugin(Processes)
  const controller = new AbortController()
  let entered!: () => void, descendant = 0
  const started = new Promise<void>(resolve => { entered = resolve })
  t.after(async () => {
    if (descendant) { try { process.kill(descendant, 'SIGKILL') } catch (error: any) { if (error.code !== 'ESRCH') throw error } }
    await plugin.dispose()
  })
  const script = receive + `const child=require('node:child_process').spawn(process.execPath,['-e',"console.log('ready');setInterval(()=>{},1000)"],{stdio:['ignore','pipe','ignore'],windowsHide:true}); child.stdout.once('data',()=>send('progress',{value:0,message:String(child.pid)})); setInterval(()=>{},1000); });`
  const execution = ctx.youdubWorker.worker(worker(script), invocation, context({ signal: controller.signal, progress: async (_, message) => { descendant = Number(message); entered() } }))
  await started
  controller.abort(new Error('cancelled by test'))
  await assert.rejects(execution)
  assert.throws(() => process.kill(descendant, 0), { code: 'ESRCH' })
})

test('Python error receipts wait for Host persistence and preserve the original provider error', async t => {
  const ctx = new Context(), plugin = await ctx.plugin(Processes)
  t.after(() => plugin.dispose())
  const receipts: string[] = []
  const script = `from backend.workers.protocol import OperationWire, WorkerError
wire = OperationWire()
wire.receive()
wire.external_state('pending')
try:
    raise WorkerError('ORIGINAL_PROVIDER_FAILURE', 'provider disconnected during request')
except Exception as error:
    wire.fail(error)
`
  await assert.rejects(ctx.youdubWorker.worker({ command: python, args: ['-B', '-c', script], cwd: process.cwd() }, invocation, context({
    externalUpdate: async receipt => { await new Promise(resolve => setTimeout(resolve, 75)); receipts.push(receipt.state) },
  })), (error: any) => error.code === 'ORIGINAL_PROVIDER_FAILURE' && /provider disconnected/.test(error.message))
  assert.deepEqual(receipts, ['unknown'])
})

test('transient EPERM from a group existence probe does not replace the worker error', { skip: process.platform === 'win32' }, async t => {
  const ctx = new Context(), plugin = await ctx.plugin(Processes)
  t.after(() => plugin.dispose())
  const kill = process.kill.bind(process)
  let injected = false
  const mocked = t.mock.method(process, 'kill', (pid: number, signal?: string | number) => {
    if (pid < 0 && signal === 0 && !injected) {
      injected = true
      throw Object.assign(new Error('kill EPERM'), { code: 'EPERM' })
    }
    return kill(pid, signal as NodeJS.Signals)
  })
  try {
    await assert.rejects(ctx.youdubWorker.worker(worker(receive + `send('error',{code:'DOWNLOAD_FAILED',message:'Original download failure'}); setInterval(()=>{},1000); });`), invocation, context()), (error: any) => error.code === 'DOWNLOAD_FAILED' && error.message === 'Original download failure')
    assert.equal(injected, true)
  } finally { mocked.mock.restore() }
})

test('Python pipes round-trip Chinese paths even when the parent requests a legacy encoding', async t => {
  const ctx = new Context(), plugin = await ctx.plugin(Processes)
  t.after(() => plugin.dispose())
  const input = JSON.stringify({ path: join('安装 空格', '真实语音 JFK.mp4'), text: '中文翻译' })
  const result = await ctx.youdubWorker.run({ command: python, args: ['-B', '-c', 'import json, sys; print(json.dumps(json.load(sys.stdin), ensure_ascii=False))'],
    input, env: { PYTHONUTF8: '0', PYTHONIOENCODING: 'cp1252' } })
  assert.deepEqual(JSON.parse(result.stdout), JSON.parse(input))
})

test('Darwin termination EPERM waits for an exiting group and preserves the worker failure', { skip: process.platform !== 'darwin' }, async t => {
  const ctx = new Context(), plugin = await ctx.plugin(Processes)
  t.after(() => plugin.dispose())
  const kill = process.kill.bind(process)
  let injected = false, pid = 0
  const mocked = t.mock.method(process, 'kill', (target: number, signal?: string | number) => {
    if (target < 0 && signal === 'SIGTERM') {
      injected = true; pid = -target
      throw Object.assign(new Error('kill EPERM during process exit'), { code: 'EPERM' })
    }
    return kill(target, signal as NodeJS.Signals)
  })
  try {
    const script = receive + `send('error',{code:'ORIGINAL_FAILURE',message:'original worker error'}); process.stdin.destroy(); });`
    await assert.rejects(ctx.youdubWorker.worker(worker(script), invocation, context()), { code: 'ORIGINAL_FAILURE' })
    assert.equal(injected, true)
    assert.throws(() => kill(-pid, 0), { code: 'ESRCH' })
  } finally { mocked.mock.restore() }
})

test('termination permission errors remain failures while a process group is still present', { skip: process.platform !== 'darwin', timeout: 10000 }, async t => {
  const ctx = new Context(), plugin = await ctx.plugin(Processes)
  const kill = process.kill.bind(process), denied = Object.assign(new Error('kill EPERM: group remains alive'), { code: 'EPERM' })
  let pid = 0, managed: { done: Promise<unknown>; stop(): Promise<void> } | undefined
  const mocked = t.mock.method(process, 'kill', (target: number, signal?: string | number) => {
    if (target < 0 && signal === 'SIGTERM') { pid = -target; throw denied }
    return kill(target, signal as NodeJS.Signals)
  })
  try {
    managed = (ctx.youdubWorker as any).launch(worker('setInterval(()=>{},1000)'))
    await assert.rejects(managed!.stop(), error => error === denied)
    assert.doesNotThrow(() => kill(-pid, 0))
  } finally {
    mocked.mock.restore()
    if (pid) { kill(-pid, 'SIGKILL'); await managed!.done }
    await plugin.dispose()
  }
})

test('structured Python errors retain status, context and their original traceback', async t => {
  const ctx = new Context(), plugin = await ctx.plugin(Processes)
  t.after(() => plugin.dispose())
  const script = `from backend.workers.protocol import OperationWire
from backend.app.v1.errors import ApiError
wire = OperationWire()
wire.receive()
try:
    raise ApiError(422, 'BAD_MODEL', 'model cannot accept the request', field='translation.model', stage='translate', action='adjust_settings')
except Exception as error:
    wire.fail(error)
`
  await assert.rejects(ctx.youdubWorker.worker({ command: python, args: ['-B', '-c', script], cwd: process.cwd() }, invocation, context()), (error: any) => {
    assert.equal(error.code, 'BAD_MODEL')
    assert.equal(error.status, 422)
    assert.equal(error.details.field, 'translation.model')
    assert.equal(error.details.stage, 'translate')
    assert.match(error.stack, /Worker stderr:[\s\S]*Traceback[\s\S]*ApiError: model cannot accept/)
    return true
  })
})

test('a cleanup failure cannot replace the original worker error', async t => {
  const ctx = new Context(), plugin = await ctx.plugin(Processes)
  t.after(() => plugin.dispose())
  const service = ctx.youdubWorker as any, launch = service.launch.bind(service)
  const cleanup = new Error('process cleanup failed')
  t.mock.method(service, 'launch', (request: any) => {
    const managed = launch(request), stop = managed.stop
    managed.stop = async () => { await stop(); throw cleanup }
    return managed
  })
  const script = receive + `send('error',{code:'ORIGINAL_FAILURE',message:'original worker error'}); setInterval(()=>{},1000); });`
  await assert.rejects(service.worker(worker(script), invocation, context()), (error: any) => {
    assert.ok(error instanceof AggregateError)
    assert.equal(error.errors[0].code, 'ORIGINAL_FAILURE')
    assert.equal(error.errors[1], cleanup)
    assert.equal(error.cause, error.errors[0])
    return true
  })
})

test('worker stderr is logged completely before failure even beyond the error tail limit', async t => {
  const ctx = new Context(), plugin = await ctx.plugin(Processes), logged: string[] = []
  t.after(() => plugin.dispose())
  const script = receive + `process.stderr.write('first diagnostic\\n'+'x'.repeat(1024*1024)+'\\nlast diagnostic',()=>{send('error',{code:'LARGE_DIAGNOSTIC',message:'failed'}); process.stdin.destroy();}); });`
  await assert.rejects(ctx.youdubWorker.worker(worker(script), invocation, context({ log: async line => { logged.push(line) } })), { code: 'LARGE_DIAGNOSTIC' })
  assert.equal(logged[0], 'first diagnostic')
  assert.equal(logged[1].length, 1024 * 1024)
  assert.equal(logged[2], 'last diagnostic')
})
