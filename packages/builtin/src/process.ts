import { Service, type Context } from 'cordis'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { AppError, WORKER_PROTOCOL, type ProcessRequest, type ProcessService, type Invocation, type InvocationContext, type OperationResult, type JsonObject } from '@youdub/sdk'

interface Managed {
  child: ChildProcessWithoutNullStreams; done: Promise<{ code: number | null; signal: string | null }>;
  stderr: string; ended: boolean; stop(): Promise<void>
}
function lines(child: Managed, consume: (message: any) => Promise<void> | void, fail: (error: Error) => void) {
  let buffer = '', chain = Promise.resolve(), failed: Error | undefined
  const reject = (error: Error) => { if (failed) return; failed = error; fail(error) }
  child.child.stdout.setEncoding('utf8')
  child.child.stdout.on('data', (chunk: string) => {
    if (failed) return
    buffer += chunk
    if (buffer.length > 32 * 1024 * 1024) { reject(new AppError('PROTOCOL_ERROR', 'Worker message exceeds 32 MiB.')); return }
    let end: number
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1)
      chain = chain.then(async () => { if (!failed) await consume(JSON.parse(line)) }).catch(reject)
    }
  })
  return async () => {
    await chain
    if (failed) throw failed
    if (buffer.trim()) throw new AppError('PROTOCOL_ERROR', 'Worker exited with an incomplete message.')
  }
}

export default class Processes extends Service implements ProcessService {
  private children = new Set<Managed>()
  constructor(ctx: Context) {
    super(ctx, 'process')
    ctx.effect(() => async () => { await Promise.all([...this.children].map(child => child.stop())) })
  }
  private launch(request: ProcessRequest): Managed {
    const child = spawn(request.command, request.args, {
      cwd: request.cwd, env: { ...process.env, ...request.env, PYTHONUNBUFFERED: '1' },
      stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32', windowsHide: true,
    })
    const managed: Managed = { child, stderr: '', ended: false, done: null!, stop: null! }
    managed.done = new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('close', (code, signal) => { managed.ended = true; this.children.delete(managed); resolve({ code, signal }) })
    })
    // The owner still awaits done; this observer prevents an early spawn failure
    // from becoming an unhandled rejection before protocol setup completes.
    void managed.done.catch(() => {})
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => { managed.stderr = (managed.stderr + chunk).slice(-1024 * 1024) })
    let stopping: Promise<void> | undefined
    managed.stop = () => stopping ??= (async () => {
      const groupAlive = () => {
        if (process.platform === 'win32') return !managed.ended
        if (!child.pid) return false
        try { process.kill(-child.pid, 0); return true }
        catch (error: any) { if (error.code === 'ESRCH') return false; throw error }
      }
      if (managed.ended && !groupAlive()) return
      const kill = (signal: NodeJS.Signals) => {
        try {
          if (process.platform === 'win32') child.kill(signal)
          else if (child.pid) process.kill(-child.pid, signal)
        } catch (error: any) { if (error.code !== 'ESRCH') throw error }
      }
      kill('SIGTERM')
      const waitGroup = async (deadline: number) => {
        while (groupAlive() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25))
        return !groupAlive()
      }
      if (!await waitGroup(Date.now() + 5000)) {
        this.ctx.logger.warn(`Process ${child.pid} ignored SIGTERM; terminating its execution group.`)
        kill('SIGKILL')
        if (!await waitGroup(Date.now() + 5000)) throw new AppError('CANCEL_TIMEOUT', `Process group ${child.pid} did not exit.`, 503)
      }
      await managed.done
    })()
    this.children.add(managed)
    return managed
  }
  async run(request: ProcessRequest & { input?: string }) {
    request.signal?.throwIfAborted()
    const child = this.launch(request)
    let stdout = '', stopError: unknown, inputError: Error | undefined
    child.child.stdout.setEncoding('utf8')
    child.child.stdout.on('data', chunk => { stdout += chunk })
    const abort = () => { void child.stop().catch(error => { stopError = error }) }
    request.signal?.addEventListener('abort', abort, { once: true })
    child.child.stdin.on('error', error => { inputError = error })
    child.child.stdin.end(request.input)
    try {
      const exit = await child.done
      if (stopError) throw stopError
      request.signal?.throwIfAborted()
      if (inputError) throw inputError
      if (exit.code !== 0) throw new AppError('PROCESS_EXITED', `${request.command} exited (${exit.code ?? exit.signal}).\n${child.stderr}`, 500)
      return { stdout, stderr: child.stderr }
    } finally {
      request.signal?.removeEventListener('abort', abort)
      await child.stop()
    }
  }
  async worker(request: ProcessRequest, invocation: Invocation, context: InvocationContext): Promise<OperationResult> {
    context.signal.throwIfAborted()
    const child = this.launch(request)
    let inputSeq = 0, outputSeq = 0, result: any, failure: Error | undefined
    const send = (type: string, payload: any) => {
      if (child.ended || child.child.stdin.destroyed) throw new AppError('WORKER_EXITED', 'Worker input is closed.', 500)
      child.child.stdin.write(JSON.stringify({ version: WORKER_PROTOCOL, invocationId: invocation.invocationId, seq: ++inputSeq, type, payload }) + '\n')
    }
    const fail = (error: Error) => { failure ??= error; void child.stop().catch(error => { failure = new AggregateError([failure, error]) }) }
    child.child.stdin.on('error', fail)
    const flush = lines(child, async message => {
      if (message.version !== WORKER_PROTOCOL || message.invocationId !== invocation.invocationId || message.seq !== ++outputSeq) throw new AppError('PROTOCOL_ERROR', 'Worker version, invocation or sequence mismatch.', 500)
      const payload = message.payload
      if (result) throw new AppError('PROTOCOL_ERROR', 'Worker sent a message after its result.', 500)
      switch (message.type) {
        case 'progress': await context.progress(payload.value ?? payload.progress ?? null, payload.message ?? ''); break
        case 'external.prepare': await context.externalPrepare(payload); send('external.accepted', { externalRequestId: payload.externalRequestId }); break
        case 'external.update': await context.externalUpdate(payload); send('external.recorded', { externalRequestId: payload.externalRequestId }); break
        case 'result': result = payload; break
        case 'error': throw new AppError(payload.code ?? 'WORKER_ERROR', payload.message ?? 'Worker failed.', 500, payload)
        default: throw new AppError('PROTOCOL_ERROR', `Unknown worker message: ${message.type}`, 500)
      }
    }, fail)
    const abort = () => {
      try { send('cancel', {}) } catch (error) { failure ??= error as Error }
      void child.stop().catch(error => { failure = error })
    }
    context.signal.addEventListener('abort', abort, { once: true })
    const resolveInputs = async (value: any): Promise<any> => {
      if (Array.isArray(value)) return Promise.all(value.map(resolveInputs))
      if (value && typeof value === 'object') {
        if (typeof value.id === 'string' && typeof value.schemaId === 'string' && Object.keys(value).length === 2) return { path: await context.resolve(value) }
        return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([key, val]) => [key, await resolveInputs(val)])))
      }
      return value
    }
    try {
      send('execute', { ...invocation, inputs: await resolveInputs(invocation.inputs), options: invocation.binding.options, credentials: context.credentials })
      const exit = await child.done
      await flush()
      if (failure) throw failure
      context.signal.throwIfAborted()
      if (exit.code !== 0) throw new AppError('WORKER_EXITED', `Worker exited (${exit.code ?? exit.signal}).\n${child.stderr}`, 500)
      if (!result) throw new AppError('PROTOCOL_ERROR', `Worker exited without a result.\n${child.stderr}`, 500)
      if (result.state === 'waiting') return result
      if (result.state !== 'completed' || !result.outputs) throw new AppError('PROTOCOL_ERROR', 'Invalid operation result.', 500)
      const refs: Record<string, any> = {}
      for (const [key, descriptor] of Object.entries(result.artifacts ?? {})) refs[key] = await context.register(descriptor as any)
      const resolveOutput = (value: any): any => {
        if (Array.isArray(value)) return value.map(resolveOutput)
        if (value && typeof value === 'object') {
          if (Object.hasOwn(value, '$artifact')) {
            if (Object.keys(value).length !== 1 || !refs[value.$artifact]) throw new AppError('PROTOCOL_ERROR', 'Unknown worker artifact reference.', 500)
            return refs[value.$artifact]
          }
          return Object.fromEntries(Object.entries(value).map(([key, val]) => [key, resolveOutput(val)]))
        }
        return value
      }
      return { state: 'completed', outputs: resolveOutput(result.outputs) }
    } finally {
      context.signal.removeEventListener('abort', abort)
      // Check the owned process group even if a third-party worker exited
      // before its descendants; no computation survives an invocation.
      await child.stop()
    }
  }
  async rpc(request: ProcessRequest) {
    const child = this.launch(request)
    let seq = 0, lastSeq = 0, closed = false, fatal: Error | undefined
    const pending = new Map<string, { resolve: (value: any) => void; reject: (error: Error) => void; method: string }>()
    const fail = (error: Error) => {
      fatal ??= error
      for (const item of pending.values()) item.reject(new AppError('COMMIT_OUTCOME_UNKNOWN', `Bridge ${item.method} lost its response: ${error.message}`, 503, { cause: error.message }))
      pending.clear()
    }
    const flush = lines(child, message => {
      if (message.version !== WORKER_PROTOCOL || message.seq !== ++lastSeq) throw new AppError('PROTOCOL_ERROR', 'Storage bridge protocol mismatch.', 503)
      const item = pending.get(message.requestId)
      if (!item) throw new AppError('PROTOCOL_ERROR', 'Unknown storage request ID.', 503)
      if (!['error', 'result'].includes(message.type)) throw new AppError('PROTOCOL_ERROR', `Unknown storage message ${message.type}`, 503)
      pending.delete(message.requestId)
      if (message.type === 'error') item.reject(new AppError(message.payload.code ?? 'STORE_ERROR', message.payload.message, message.payload.status ?? 500, message.payload))
      else item.resolve(message.payload)
    }, fail)
    child.child.stdin.on('error', fail)
    void child.done.then(async exit => { await flush(); if (!closed || exit.code !== 0) fail(new Error(`Storage bridge exited (${exit.code ?? exit.signal}). ${child.stderr}`)) }, fail).catch(fail)
    const close = async () => {
      closed = true; child.child.stdin.end()
      const exit = await child.done
      if (exit.code !== 0) throw new AppError('STORE_EXIT_FAILED', `Storage shutdown failed (${exit.code ?? exit.signal}): ${child.stderr}`, 500)
      if (pending.size) { fail(new Error('Storage stopped with pending operations.')); throw fatal }
    }
    // Both provider and process-service disposal close this same owned stream.
    // A storage transaction finishes before EOF; concurrent disposal never
    // sends SIGTERM while the storage provider is closing normally.
    child.stop = close
    return {
      call: <T = any>(method: string, params: JsonObject = {}): Promise<T> => {
        if (fatal) return Promise.reject(fatal)
        if (closed || child.ended) return Promise.reject(new AppError('STORE_UNAVAILABLE', 'Storage bridge is closed.', 503))
        const requestId = randomUUID()
        return new Promise((resolve, reject) => {
          pending.set(requestId, { resolve, reject, method })
          child.child.stdin.write(JSON.stringify({ version: WORKER_PROTOCOL, requestId, seq: ++seq, type: 'request', payload: { method, params } }) + '\n')
        })
      },
      close,
    }
  }
}
