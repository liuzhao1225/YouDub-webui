/**
 * The process model: a command runs in its own worker, reaches the VFS only by
 * message, and dies when the host says so.
 *
 * The `Worker` here is a loopback that runs the REAL child half
 * (`runShellProcess`) against the REAL host half, so the frames, the
 * filesystem service, and the termination ladder are the shipped ones — only
 * the thread boundary is simulated, because a Node test host has no DOM
 * `Worker` to cross. The real browser Worker boundary is not exercised here.
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MemoryVfs } from '@deepseek-ai/dsh-experimental-webworker-runtime/src/storage/memory.ts'
import { setActiveVfs } from '@deepseek-ai/dsh-experimental-webworker-runtime/src/storage/active.ts'
import { startProcess } from '@deepseek-ai/dsh-experimental-webworker-runtime/src/shell/process/host.ts'
import { runShellProcess } from '@deepseek-ai/dsh-experimental-webworker-runtime/src/shell/process/child.ts'
import { isShellStartFrame } from '@deepseek-ai/dsh-experimental-webworker-runtime/src/shell/process/protocol.ts'
import type { FromProcessFrame, ToProcessFrame } from '@deepseek-ai/dsh-experimental-webworker-runtime/src/shell/process/protocol.ts'

const WORKSPACE = '/dsh/workspace'
const WORKER_URL = 'https://example.test/assets/worker.js'

let vfs: MemoryVfs
/** Every loopback worker the code under test constructed. */
let started: LoopbackWorker[]

/**
 * A `Worker` that keeps the child half on this thread. Delivery is deferred so
 * neither half can observe the other's synchronous progress, which is the one
 * property of the real boundary that changes behaviour.
 */
class LoopbackWorker {
  readonly url: string
  terminated = false
  private readonly hostListeners: ((event: MessageEvent) => void)[] = []
  private childListener: ((event: MessageEvent) => void) | undefined
  private closed = false

  constructor(url: string | URL, options?: { type?: string }) {
    this.url = String(url)
    expect(options?.type).toBe('module')
    started.push(this)
  }

  /** Host → child. The first frame starts the real child half. */
  postMessage(frame: ToProcessFrame): void {
    if (this.terminated) return
    queueMicrotask(() => {
      if (this.terminated) return
      if (isShellStartFrame(frame)) {
        runShellProcess(frame, {
          postMessage: (reply: FromProcessFrame) => { this.toHost(reply) },
          addEventListener: (_type: 'message', listener: (event: MessageEvent) => void) => { this.childListener = listener },
          close: () => { this.closed = true },
        })
        return
      }
      this.childListener?.({ data: frame } as MessageEvent)
    })
  }

  /** Child → host. */
  private toHost(frame: FromProcessFrame): void {
    if (this.terminated) return
    queueMicrotask(() => {
      if (this.terminated) return
      for (const listener of this.hostListeners) listener({ data: frame } as MessageEvent)
    })
  }

  addEventListener(type: 'message' | 'error', listener: (event: MessageEvent) => void): void {
    if (type === 'message') this.hostListeners.push(listener)
  }

  terminate(): void {
    this.terminated = true
  }

  /** Whether the child closed itself after reporting its status. */
  get childClosed(): boolean {
    return this.closed
  }
}

beforeEach(() => {
  vfs = new MemoryVfs()
  setActiveVfs(vfs)
  vfs.mkdirSync(WORKSPACE, { recursive: true })
  started = []
  // The selection in `startProcess` reads exactly these two globals.
  vi.stubGlobal('Worker', LoopbackWorker)
  vi.stubGlobal('self', { location: { href: WORKER_URL } })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** Run one command line through the process model and collect everything. */
async function run(script: string, stdin = ''): Promise<{ code: number; stdout: string; stderr: string }> {
  let stdout = ''
  let stderr = ''
  const code = await new Promise<number>((settle) => {
    startProcess({
      script,
      argv: ['bash', '-c', script],
      cwd: WORKSPACE,
      env: { HOME: '/dsh/home' },
      stdin,
      onOutput: (stream, text) => {
        if (stream === 'stdout') stdout += text
        else stderr += text
      },
      onExit: settle,
    })
  })
  return { code, stdout, stderr }
}

it('starts the command as a worker from this bundle, not on this thread', async () => {
  await run('echo hi')
  expect(started).toHaveLength(1)
  // The child is this very bundle in another role: no second asset to serve.
  expect(started[0]?.url).toBe(WORKER_URL)
})

it('runs the command in the child and reports its output and status', async () => {
  expect(await run('echo hi; echo oops >&2; exit 3')).toEqual({ code: 3, stdout: 'hi\n', stderr: 'oops\n' })
})

it('reaches the host filesystem by message', async () => {
  const written = await run('mkdir -p nested && echo carried > nested/file.txt && cat nested/file.txt')
  expect(written).toEqual({ code: 0, stdout: 'carried\n', stderr: '' })
  // The child holds no VFS of its own: the bytes can only have arrived here
  // through the filesystem frames.
  expect(vfs.readFileSync(`${WORKSPACE}/nested/file.txt`, 'utf8')).toBe('carried\n')
})

it('carries a filesystem failure back with its code, not as a lost exception', async () => {
  const missing = await run('cat nowhere.txt')
  expect(missing.code).toBe(1)
  expect(missing.stderr).toBe('cat: nowhere.txt: No such file or directory\n')
})

it('delivers standard input to the child', async () => {
  expect((await run('grep -c ""', 'a\nb\nc\n')).stdout).toBe('3\n')
})

it('closes the child once the command settles', async () => {
  await run('true')
  expect(started[0]?.childClosed).toBe(true)
})

it('asks first and terminates second', async () => {
  const events: number[] = []
  const running = startProcess({
    script: 'sleep 30',
    argv: ['bash', '-c', 'sleep 30'],
    cwd: WORKSPACE,
    env: {},
    stdin: '',
    onOutput: () => {},
    onExit: code => events.push(code),
  })
  // The first rung asks the command to stop; a `sleep` honours it.
  running.interrupt()
  await vi.waitFor(() => { expect(events).toHaveLength(1) })
  expect(events[0]).toBe(130)

  // The second rung does not ask: the worker is gone whatever it was doing.
  const stubborn = startProcess({
    script: 'sleep 30',
    argv: ['bash', '-c', 'sleep 30'],
    cwd: WORKSPACE,
    env: {},
    stdin: '',
    onOutput: () => {},
    onExit: code => events.push(code),
  })
  stubborn.destroy()
  await vi.waitFor(() => { expect(events).toHaveLength(2) })
  expect(started[1]?.terminated).toBe(true)
})

it('runs an explicit argv without a command line to parse', async () => {
  vfs.writeFileSync(`${WORKSPACE}/spaced name.txt`, 'kept\n')
  let stdout = ''
  const code = await new Promise<number>((settle) => {
    startProcess({
      argv: ['cat', 'spaced name.txt'],
      cwd: WORKSPACE,
      env: {},
      stdin: '',
      onOutput: (_stream, text) => { stdout += text },
      onExit: settle,
    })
  })
  expect({ code, stdout }).toEqual({ code: 0, stdout: 'kept\n' })
})
