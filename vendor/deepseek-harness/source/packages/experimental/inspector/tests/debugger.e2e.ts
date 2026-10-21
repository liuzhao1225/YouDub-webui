import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import WebSocket, { type RawData } from 'ws'
import { afterEach, describe, expect, it } from 'vitest'
import { isPlainObject } from '../src/shared/json.ts'

interface CdpMessage {
  readonly id?: number
  readonly method?: string
  readonly params?: Record<string, unknown>
  readonly result?: Record<string, unknown>
  readonly error?: { message: string }
}

class CdpClient {
  private nextId = 0
  private readonly pending = new Map<number, (message: CdpMessage) => void>()
  private readonly events: CdpMessage[] = []
  private readonly eventWaiters = new Set<() => void>()

  private constructor(private readonly socket: WebSocket) {
    socket.on('message', (data) => {
      const message = JSON.parse(rawText(data)) as CdpMessage
      if (message.id !== undefined) this.pending.get(message.id)?.(message)
      else {
        this.events.push(message)
        for (const wake of [...this.eventWaiters]) wake()
      }
    })
  }

  static async connect(url: string): Promise<CdpClient> {
    const socket = new WebSocket(url)
    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => { resolve() })
      socket.once('error', reject)
    })
    return new CdpClient(socket)
  }

  call(method: string, params: Record<string, unknown> = {}): Promise<CdpMessage> {
    const id = ++this.nextId
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { reject(new Error(`CDP call timed out: ${method}`)) }, 5_000)
      this.pending.set(id, (message) => {
        clearTimeout(timer)
        this.pending.delete(id)
        resolve(message)
      })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }

  waitForEvent(method: string, predicate: (event: CdpMessage) => boolean = () => true): Promise<CdpMessage> {
    const found = this.events.find(event => event.method === method && predicate(event))
    if (found !== undefined) return Promise.resolve(found)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.eventWaiters.delete(check)
        reject(new Error(`CDP event timed out: ${method}`))
      }, 5_000)
      const check = (): void => {
        const event = this.events.find(candidate => candidate.method === method && predicate(candidate))
        if (event === undefined) return
        clearTimeout(timer)
        this.eventWaiters.delete(check)
        resolve(event)
      }
      this.eventWaiters.add(check)
    })
  }

  async close(): Promise<void> {
    if (this.socket.readyState === WebSocket.CLOSED) return
    const closed = new Promise<void>((resolve) => { this.socket.once('close', () => { resolve() }) })
    this.socket.close()
    await closed
  }
}

function rawText(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8')
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8')
  return Buffer.from(data).toString('utf8')
}

describe('Host debugger through the Inspector Worker', () => {
  let child: ChildProcessWithoutNullStreams | undefined
  let cdp: CdpClient | undefined

  afterEach(async () => {
    await cdp?.close()
    cdp = undefined
    if (child !== undefined && child.exitCode === null) child.kill('SIGKILL')
    child = undefined
  })

  it('evaluates a paused Host frame and resumes while the main thread is stopped', async () => {
    const fixture = fileURLToPath(new URL('./fixtures/debug-host.ts', import.meta.url))
    const tsx = import.meta.resolve('tsx/esm')
    child = spawn(process.execPath, ['--import', tsx, fixture], {
      env: { ...process.env, TSX_TSCONFIG_PATH: fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url)) },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const firstLine = await readLine(child)
    const endpoint = JSON.parse(firstLine) as { webSocketDebuggerUrl: string }
    cdp = await CdpClient.connect(endpoint.webSocketDebuggerUrl)
    expect((await cdp.call('Runtime.enable')).error).toBeUndefined()
    expect((await cdp.call('Debugger.enable')).error).toBeUndefined()
    const parsed = await cdp.waitForEvent('Debugger.scriptParsed', event =>
      String(event.params?.url).endsWith('/debug-host.ts'))
    const scriptId = parsed.params?.scriptId
    expect(typeof scriptId).toBe('string')
    const source = await cdp.call('Debugger.getScriptSource', { scriptId })
    expect(source.result?.scriptSource).toContain('breakpointProbe')
    await cdp.call('Runtime.evaluate', { expression: 'console.log("host-console-probe")' })
    const consoleEvent = await cdp.waitForEvent('Runtime.consoleAPICalled', (event) => {
      const args = event.params?.args
      return Array.isArray(args) && args.some(arg => isPlainObject(arg) && arg.value === 'host-console-probe')
    })
    expect(consoleEvent.params?.type).toBe('log')
    const evaluated = await cdp.call('Runtime.evaluate', {
      expression: 'globalThis.__inspectorBreakpointProbe',
    })
    const objectId = (evaluated.result?.result as Record<string, unknown> | undefined)?.objectId
    expect(typeof objectId).toBe('string')
    expect((await cdp.call('Debugger.setBreakpointOnFunctionCall', { objectId })).error).toBeUndefined()

    child.stdin.write('run\n')
    const paused = await cdp.waitForEvent('Debugger.paused')
    const callFrames = paused.params?.callFrames as Array<Record<string, unknown>>
    const callFrameId = callFrames[0]?.callFrameId
    expect(typeof callFrameId).toBe('string')
    const scopeChain = callFrames[0]?.scopeChain as Array<Record<string, unknown>>
    const scopeObjectId = (scopeChain[0]?.object as Record<string, unknown> | undefined)?.objectId
    expect(String(scopeObjectId)).toMatch(/^runtime:/u)
    expect((await cdp.call('Runtime.getProperties', { objectId: scopeObjectId })).error).toBeUndefined()

    // This Worker-local request must complete while the Host main thread is paused.
    expect((await cdp.call('DSHInspector.getSources')).result?.sources).toBeDefined()
    const local = await cdp.call('Debugger.evaluateOnCallFrame', {
      callFrameId,
      expression: 'value',
      returnByValue: true,
    })
    expect(local.result?.result).toMatchObject({ type: 'number', value: 41 })
    const object = await cdp.call('Debugger.evaluateOnCallFrame', {
      callFrameId,
      expression: '({ pausedValue: value })',
      objectGroup: 'backtrace',
    })
    const pausedObjectId = (object.result?.result as Record<string, unknown> | undefined)?.objectId
    expect(String(pausedObjectId)).toMatch(/^runtime:/u)
    expect((await cdp.call('Runtime.getProperties', { objectId: pausedObjectId })).error).toBeUndefined()
    expect((await cdp.call('Debugger.resume')).error).toBeUndefined()
    const completed = await cdp.call('Runtime.evaluate', {
      expression: 'globalThis.__inspectorBreakpointResult',
      returnByValue: true,
    })
    expect(completed.result?.result).toMatchObject({ type: 'number', value: 42 })

    const exited = new Promise<number | null>((resolve) => { child!.once('exit', resolve) })
    child.stdin.write('stop\n')
    expect(await exited).toBe(0)
    child = undefined
    cdp = undefined
  }, 20_000)
})

function readLine(child: ChildProcessWithoutNullStreams): Promise<string> {
  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    const onData = (chunk: Buffer): void => {
      stdout += chunk.toString('utf8')
      const newline = stdout.indexOf('\n')
      if (newline === -1) return
      cleanup()
      resolve(stdout.slice(0, newline))
    }
    const onError = (error: Error): void => { cleanup(); reject(error) }
    const onExit = (): void => {
      cleanup()
      reject(new Error(`debug Host exited before output; stderr:\n${stderr}`))
    }
    const onStderr = (chunk: Buffer): void => { stderr += chunk.toString('utf8') }
    const cleanup = (): void => {
      child.stdout.off('data', onData)
      child.stderr.off('data', onStderr)
      child.off('error', onError)
      child.off('exit', onExit)
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onStderr)
    child.once('error', onError)
    child.once('exit', onExit)
  })
}
