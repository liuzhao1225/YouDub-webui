/**
 * The frames a shell process and its host exchange.
 *
 * A command runs in its own Web Worker, which owns no filesystem: the VFS
 * stays in the host worker and every read or write is a request on this
 * channel. Blocking the child on a reply is impossible here (that would need
 * `SharedArrayBuffer`, which requires a cross-origin isolation this deployment
 * cannot have), so the filesystem face is asynchronous end to end.
 * @module @deepseek-ai/dsh-experimental-webworker-runtime/src/shell/process/protocol
 */

/** The first frame a process worker receives; it also selects its role. */
export interface ShellStartFrame {
  t: 'shell-start'
  /** Command source for `bash -c`, or undefined when `argv` names a program directly. */
  script?: string | undefined
  /** The program and arguments, used when `script` is absent. */
  argv: readonly string[]
  /** Working directory the command starts in. */
  cwd: string
  /** Environment the command starts with. */
  env: Record<string, string>
  /** Everything on standard input. */
  stdin: string
}

/** Output produced by the command, forwarded as it is written. */
export interface ShellOutputFrame {
  t: 'shell-out'
  stream: 'stdout' | 'stderr'
  text: string
}

/** The command settled; the process worker closes itself right after. */
export interface ShellExitFrame {
  t: 'shell-exit'
  code: number
}

/** A signal the command is asked to honor (the terminate ladder's first rung). */
export interface ShellSignalFrame {
  t: 'shell-signal'
}

/** Filesystem operations a process worker can ask its host to perform. */
export type FilesystemOperation = 'stat' | 'list' | 'readText' | 'writeText' | 'mkdir' | 'remove' | 'rename'

/** One filesystem call, awaiting its reply by `id`. */
export interface FilesystemCallFrame {
  t: 'fs-call'
  id: number
  op: FilesystemOperation
  args: readonly unknown[]
}

/**
 * One filesystem reply. A failure carries the Node error `code` because the
 * utilities branch on it (`ENOENT` prints "No such file or directory"), and an
 * Error instance does not survive structured cloning with its class.
 */
export interface FilesystemReplyFrame {
  t: 'fs-reply'
  id: number
  value?: unknown
  failure?: { code?: string | undefined; message: string }
}

/** Everything the host sends to a process worker. */
export type ToProcessFrame = ShellStartFrame | ShellSignalFrame | FilesystemReplyFrame

/** Everything a process worker sends to its host. */
export type FromProcessFrame = ShellOutputFrame | ShellExitFrame | FilesystemCallFrame

/**
 * Whether a message is the frame that turns a fresh worker into a shell
 * process. The host worker's entry reads this to pick its role.
 * @param data - the raw message payload.
 * @returns true when the payload starts a shell process.
 */
export function isShellStartFrame(data: unknown): data is ShellStartFrame {
  return typeof data === 'object' && data !== null && (data as { t?: unknown }).t === 'shell-start'
}
