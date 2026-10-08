import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { Context } from 'cordis'
import Processes from '../src/process.js'
import type { Invocation, InvocationContext } from '@youdub/sdk'

const invocation = { invocationId: 'protocol-test', taskId: 'task', attempt: 1, stepId: 'step', binding: { options: {} }, inputs: {} } as Invocation
function worker(script: string) { return { command: process.execPath, args: ['-e', script] } }
function context(override: Partial<InvocationContext> = {}): InvocationContext {
  return { signal: new AbortController().signal, progress: async () => {}, externalPrepare: async () => {}, externalUpdate: async () => {}, register: async () => ({ id: 'artifact', schemaId: 'file/v1' }), resolve: async () => '', credentials: {}, ...override }
}
const receive = `process.stdin.once('data', raw => { const request = JSON.parse(raw.toString()); const send = (type, payload, seq = 1) => process.stdout.write(JSON.stringify({version:'youdub-worker/v1',invocationId:request.invocationId,seq,type,payload})+'\\n'); `

test('unknown RPC message rejects its request instead of abandoning it', async t => {
  const ctx = new Context(), processPlugin = await ctx.plugin(Processes)
  const rpc = await ctx.process.rpc(worker(`process.stdin.once('data', raw => {const m=JSON.parse(raw); process.stdout.write(JSON.stringify({version:m.version,requestId:m.requestId,seq:1,type:'unknown',payload:{}})+'\\n');});`))
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
  await assert.rejects(ctx.process.worker(worker(script), invocation, context({ externalPrepare: async () => { prepares++ }, progress: async () => { progress++ } })))
  assert.equal(prepares, 0, 'No new external intent may be recorded after protocol failure.')
  assert.equal(progress, 0, 'No progress may be persisted after protocol failure.')
})

test('worker result followed by abnormal exit never registers successful artifacts', async t => {
  const ctx = new Context(), plugin = await ctx.plugin(Processes)
  t.after(() => plugin.dispose())
  let registrations = 0
  const script = receive + `send('result',{state:'completed',outputs:{file:{$artifact:'f'}},artifacts:{f:{path:'x.txt',mimeType:'text/plain',schemaId:'file/v1'}}}); process.exitCode=9; process.stdin.destroy(); });`
  await assert.rejects(ctx.process.worker(worker(script), invocation, context({ register: async () => { registrations++; return { id: 'x', schemaId: 'file/v1' } } })), /Worker exited \(9\)/)
  assert.equal(registrations, 0)
})

test('worker cancellation waits for the running process to exit', async t => {
  const ctx = new Context(), plugin = await ctx.plugin(Processes)
  t.after(() => plugin.dispose())
  const controller = new AbortController()
  let entered!: () => void, pid = 0
  const started = new Promise<void>(resolve => { entered = resolve })
  const script = receive + `send('progress',{value:0,message:String(process.pid)}); setInterval(()=>{},1000); });`
  const execution = ctx.process.worker(worker(script), invocation, context({ signal: controller.signal, progress: async (_, message) => { pid = Number(message); entered() } }))
  await started
  controller.abort(new Error('cancelled by test'))
  await assert.rejects(execution)
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' })
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
  await assert.rejects(ctx.process.worker({ command: resolve('.venv/bin/python'), args: ['-B', '-c', script], cwd: process.cwd() }, invocation, context({
    externalUpdate: async receipt => { await new Promise(resolve => setTimeout(resolve, 75)); receipts.push(receipt.state) },
  })), (error: any) => error.code === 'ORIGINAL_PROVIDER_FAILURE' && /provider disconnected/.test(error.message))
  assert.deepEqual(receipts, ['unknown'])
})
