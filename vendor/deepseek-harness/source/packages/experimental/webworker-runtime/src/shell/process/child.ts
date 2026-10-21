/**
 * The process worker's own half: a fresh worker that received a
 * {@link ShellStartFrame} runs one command here and then closes.
 *
 * It mounts no VFS image, boots no Cordis tree, and loads no plugins — the
 * only thing it shares with the host worker is the bundle it was started from.
 * Its filesystem is the host's, reached by message.
 * @module @deepseek-ai/dsh-experimental-webworker-runtime/src/shell/process/child
 */

import { runShellCommand, runShellProgram } from '../interpret.ts'
import { filesystemError } from '../fs-access.ts'
import type { ShellDirent, ShellFileSystem, ShellStats } from '../types.ts'
import type { FilesystemOperation, FromProcessFrame, ShellStartFrame, ToProcessFrame } from './protocol.ts'

/** The messaging face this module needs from a worker scope. */
export interface ProcessScope {
  postMessage(frame: FromProcessFrame): void
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void
  close(): void
}

/**
 * Run one command as this worker's whole purpose, then close.
 *
 * Output is forwarded as it is written, so a caller reading a background job
 * sees progress before the command settles.
 * @param start - the frame that named the command, its directory, and its input.
 * @param scope - the worker scope to message through (`self`).
 */
export function runShellProcess(start: ShellStartFrame, scope: ProcessScope): void {
  const pending = new Map<number, { settle: (value: unknown) => void; fail: (error: unknown) => void }>()
  const stopping = new AbortController()
  let nextCall = 0

  scope.addEventListener('message', (event: MessageEvent) => {
    const frame = event.data as ToProcessFrame
    if (frame.t === 'shell-signal') {
      // The host's first termination rung: the command stops at its next
      // command boundary. A command that ignores it gets terminated instead.
      stopping.abort(new Error('killed by signal'))
      return
    }
    if (frame.t !== 'fs-reply') return
    const waiting = pending.get(frame.id)
    if (waiting === undefined) return
    pending.delete(frame.id)
    if (frame.failure === undefined) waiting.settle(frame.value)
    else waiting.fail(filesystemError(frame.failure.code ?? 'EIO', 'fs', frame.failure.message))
  })

  const call = async (op: FilesystemOperation, args: readonly unknown[]): Promise<unknown> => {
    nextCall += 1
    const id = nextCall
    const reply = new Promise<unknown>((settle, fail) => { pending.set(id, { settle, fail }) })
    scope.postMessage({ t: 'fs-call', id, op, args })
    return await reply
  }

  const fs: ShellFileSystem = {
    stat: async (path: string) => await call('stat', [path]) as ShellStats | undefined,
    list: async (path: string) => await call('list', [path]) as ShellDirent[],
    readText: async (path: string) => await call('readText', [path]) as string,
    writeText: async (path: string, text: string, append = false) => { await call('writeText', [path, text, append]) },
    mkdir: async (path: string, recursive: boolean) => { await call('mkdir', [path, recursive]) },
    remove: async (path: string, options: { recursive: boolean; force: boolean }) => { await call('remove', [path, options]) },
    rename: async (from: string, to: string) => { await call('rename', [from, to]) },
  }

  const options = {
    cwd: start.cwd,
    env: start.env,
    stdin: start.stdin,
    signal: stopping.signal,
    fs,
    onOutput: (stream: 'stdout' | 'stderr', text: string) => { scope.postMessage({ t: 'shell-out', stream, text }) },
  }
  const run = start.script === undefined
    ? runShellProgram(start.argv, options)
    : runShellCommand(start.script, options)
  void run.then(
    (outcome) => {
      scope.postMessage({ t: 'shell-exit', code: outcome.exitCode })
      scope.close()
    },
    (error: unknown) => {
      // The interpreter contains its own failures; reaching here means the
      // shell machinery itself broke, which the host reports as a failed spawn.
      scope.postMessage({ t: 'shell-out', stream: 'stderr', text: `bash: ${String(error)}\n` })
      scope.postMessage({ t: 'shell-exit', code: 1 })
      scope.close()
    },
  )
}
