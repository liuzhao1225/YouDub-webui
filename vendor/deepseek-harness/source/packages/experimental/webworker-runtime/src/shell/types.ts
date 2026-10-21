/**
 * Types of the in-worker shell: the state one command line mutates, the byte
 * face a program reads and writes, and the program signature the command table
 * stores. A browser worker has no processes, so a "program" is a JavaScript
 * function over the VFS and the state below is the whole machine.
 * @module @deepseek-ai/dsh-experimental-webworker-runtime/src/shell/types
 */

/**
 * Mutable state of one shell instance. A subshell copies it; a group and the
 * top level share it, which is what makes `cd` visible to later commands of
 * the same line and invisible outside `( … )`.
 */
export interface ShellState {
  /** Absolute working directory every relative path resolves against. */
  cwd: string
  /** Exported variables — the environment a program reads. */
  environment: Record<string, string>
  /** Shell variables that were assigned but never exported. */
  variables: Record<string, string>
  /** Exit status of the last completed command, read back as `$?`. */
  lastStatus: number
  /** Set by `exit`; the interpreter stops the line and reports this status. */
  exitRequested: number | undefined
  /**
   * The caller's cancellation, for programs that would otherwise keep the
   * whole line waiting after a kill. The interpreter checks it between
   * commands; a program that waits on anything must check it too.
   */
  readonly signal: AbortSignal | undefined
}

/**
 * The byte face of one running program. Output is collected as text rather
 * than streamed: every program is a JavaScript function that returns before
 * the next one starts, so a pipeline is a string handed along, and nothing in
 * this shell can observe a partially written stream.
 */
export interface ShellIo {
  /** Everything on standard input, already complete. */
  readonly stdin: string
  /** Append to standard output. Declared as a value: redirections hand it around. */
  readonly out: (text: string) => void
  /** Append to standard error. Declared as a value: redirections hand it around. */
  readonly err: (text: string) => void
}

/** One directory entry, as the listing, glob, and walk programs read it. */
export interface ShellDirent {
  readonly name: string
  readonly directory: boolean
}

/** What a program can learn about one path. */
export interface ShellStats {
  readonly directory: boolean
  readonly size: number
  readonly mtimeMs: number
}

/**
 * The filesystem a shell run acts on.
 *
 * Asynchronous by construction: a command that runs in its own worker reaches
 * the VFS by message, and the browser offers no way to block on that (a
 * synchronous face would need `SharedArrayBuffer`, which requires
 * cross-origin isolation this deployment cannot have). The in-host
 * implementation answers immediately from the mounted VFS.
 */
export interface ShellFileSystem {
  /**
   * Stat one path.
   * @param path - absolute VFS path.
   * @returns the entry's facts, or undefined when nothing is there.
   */
  stat(path: string): Promise<ShellStats | undefined>
  /**
   * List one directory.
   * @param path - absolute VFS path of the directory.
   * @returns its entries, sorted by name.
   * @throws a Node-shaped error when the path is absent or is not a directory.
   */
  list(path: string): Promise<ShellDirent[]>
  /**
   * Read one file as UTF-8 text.
   * @param path - absolute VFS path.
   * @returns the file's contents.
   * @throws a Node-shaped error when the path is absent or is a directory.
   */
  readText(path: string): Promise<string>
  /**
   * Write text to one file.
   * @param path - absolute VFS path; its parent must exist.
   * @param text - the text to store.
   * @param append - true to keep the existing contents and add after them.
   */
  writeText(path: string, text: string, append?: boolean): Promise<void>
  /**
   * Create one directory.
   * @param path - absolute VFS path.
   * @param recursive - true to create missing parents and tolerate an existing directory.
   */
  mkdir(path: string, recursive: boolean): Promise<void>
  /**
   * Remove one path.
   * @param path - absolute VFS path.
   * @param options - `recursive` to take a whole subtree, `force` to tolerate absence.
   */
  remove(path: string, options: { recursive: boolean; force: boolean }): Promise<void>
  /**
   * Move one file or subtree.
   * @param from - absolute source path.
   * @param to - absolute destination path.
   */
  rename(from: string, to: string): Promise<void>
}

/**
 * One executable of the command table.
 *
 * A program reports its exit status like a POSIX process: 0 for success, and a
 * nonzero status it also explains on {@link ShellIo.err}. Throwing is reserved
 * for a defect in the program itself — the interpreter turns a throw into
 * status 1 plus a diagnostic naming the program.
 * @param argv - the program name at index 0, then its arguments, fully expanded.
 * @param io - standard input contents and the output sinks.
 * @param state - shell state; a program that changes it (`cd`, `export`) mutates in place.
 * @param fs - the filesystem this run acts on.
 * @returns the exit status.
 */
export type ShellProgram = (
  argv: readonly string[],
  io: ShellIo,
  state: ShellState,
  fs: ShellFileSystem,
) => number | Promise<number>

/** Outcome of one interpreted command line. */
export interface ShellRunOutcome {
  /** Exit status of the last command the line ran. */
  exitCode: number
  /** Everything written to standard output. */
  stdout: string
  /** Everything written to standard error. */
  stderr: string
}
