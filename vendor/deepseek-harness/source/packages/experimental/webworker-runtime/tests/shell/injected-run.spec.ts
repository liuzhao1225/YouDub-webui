/**
 * The two run options a command inside a process worker supplies: the
 * filesystem it acts on, and the callback that reports output before the run
 * settles. `src/shell/process/child.ts` passes a message-backed filesystem and
 * posts a frame per write, so both are load-bearing for every backgrounded
 * command the bash tool starts.
 *
 * No VFS is mounted here, deliberately. The in-host filesystem reads the
 * process-wide slot on first use, so a program that reached it instead of the
 * injected face fails with `no filesystem is mounted` — a suite that mounted a
 * VFS as well would pass either way.
 */
import { describe, expect, it } from 'vitest'
import { runShellCommand } from '@deepseek-ai/dsh-experimental-webworker-runtime/src/shell/interpret.ts'
import { filesystemError } from '@deepseek-ai/dsh-experimental-webworker-runtime/src/shell/fs-access.ts'
import type {
  ShellDirent, ShellFileSystem, ShellRunOutcome, ShellStats,
} from '@deepseek-ai/dsh-experimental-webworker-runtime/src/shell/types.ts'

const WORKSPACE = '/dsh/workspace'

/** One call a program made on the injected filesystem. */
interface Call {
  readonly op: string
  readonly path: string
  readonly text?: string
  readonly append?: boolean
}

/**
 * A filesystem over a flat map of absolute paths, recording every call.
 *
 * Directories are the parents of the files it holds, which is all the programs
 * below ask about; nothing here reaches the mounted VFS.
 */
function recordingFileSystem(files: Record<string, string>): {
  fs: ShellFileSystem
  calls: Call[]
  contents: Map<string, string>
} {
  const contents = new Map(Object.entries(files))
  const calls: Call[] = []
  const directories = (): Set<string> => {
    const known = new Set<string>()
    for (const path of contents.keys()) {
      for (let parent = path.slice(0, path.lastIndexOf('/')); parent !== ''; parent = parent.slice(0, parent.lastIndexOf('/'))) {
        known.add(parent)
      }
    }
    return known
  }
  const fs: ShellFileSystem = {
    stat: async (path: string): Promise<ShellStats | undefined> => {
      calls.push({ op: 'stat', path })
      const text = contents.get(path)
      if (text !== undefined) return { directory: false, size: text.length, mtimeMs: 1 }
      return directories().has(path) ? { directory: true, size: 0, mtimeMs: 1 } : undefined
    },
    list: async (path: string): Promise<ShellDirent[]> => {
      calls.push({ op: 'list', path })
      if (!directories().has(path)) throw filesystemError('ENOENT', 'scandir', path)
      const prefix = `${path}/`
      const names = new Set<string>()
      for (const candidate of [...contents.keys(), ...directories()]) {
        if (!candidate.startsWith(prefix)) continue
        names.add(candidate.slice(prefix.length).split('/')[0] as string)
      }
      return [...names].sort().map(name => ({ name, directory: directories().has(`${prefix}${name}`) }))
    },
    readText: async (path: string): Promise<string> => {
      calls.push({ op: 'readText', path })
      const text = contents.get(path)
      if (text === undefined) throw filesystemError('ENOENT', 'open', path)
      return text
    },
    writeText: async (path: string, text: string, append = false): Promise<void> => {
      calls.push({ op: 'writeText', path, text, append })
      contents.set(path, append ? `${contents.get(path) ?? ''}${text}` : text)
    },
    mkdir: async (path: string, recursive: boolean): Promise<void> => {
      calls.push({ op: 'mkdir', path, append: recursive })
    },
    remove: async (path: string): Promise<void> => {
      calls.push({ op: 'remove', path })
      contents.delete(path)
    },
    rename: async (from: string, to: string): Promise<void> => {
      calls.push({ op: 'rename', path: from, text: to })
      const text = contents.get(from)
      if (text === undefined) throw filesystemError('ENOENT', 'rename', from)
      contents.delete(from)
      contents.set(to, text)
    },
  }
  return { fs, calls, contents }
}

describe('injected filesystem', () => {
  it('reads through the injected face, at the path the shell resolved', async () => {
    const { fs, calls } = recordingFileSystem({ [`${WORKSPACE}/notes.txt`]: 'alpha\nbeta\n' })
    const result = await runShellCommand('cat notes.txt', { cwd: WORKSPACE, env: {}, fs })
    expect(result).toEqual({ exitCode: 0, stdout: 'alpha\nbeta\n', stderr: '' })
    // Programs receive the word as written; the absolute path is the shell's work.
    expect(calls.filter(call => call.op === 'readText').map(call => call.path)).toEqual([`${WORKSPACE}/notes.txt`])
  })

  it('performs a redirection as a truncating write followed by appends', async () => {
    const { fs, calls, contents } = recordingFileSystem({})
    const result = await runShellCommand('echo one > out.txt; echo two >> out.txt', { cwd: WORKSPACE, env: {}, fs })
    expect(result.exitCode).toBe(0)
    expect(contents.get(`${WORKSPACE}/out.txt`)).toBe('one\ntwo\n')
    expect(calls.filter(call => call.op === 'writeText').map(call => [call.text, call.append])).toEqual([
      // `> file` empties the file when the redirection is set up, so a command
      // that writes nothing still leaves it empty.
      ['', false],
      ['one\n', true],
      ['two\n', true],
    ])
  })

  it('reports an injected failure as the utility does, not as a filesystem error', async () => {
    const { fs } = recordingFileSystem({})
    const result = await runShellCommand('cat missing.txt', { cwd: WORKSPACE, env: {}, fs })
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toBe('cat: missing.txt: No such file or directory\n')
  })
})

describe('incremental output', () => {
  /** Run a line, collecting what the callback saw in order. */
  async function reported(command: string): Promise<{ seen: [string, string][]; outcome: ShellRunOutcome }> {
    const { fs } = recordingFileSystem({ [`${WORKSPACE}/notes.txt`]: 'alpha\n' })
    const seen: [string, string][] = []
    const outcome = await runShellCommand(command, {
      cwd: WORKSPACE,
      env: {},
      fs,
      onOutput: (stream, text) => { seen.push([stream, text]) },
    })
    return { seen, outcome }
  }

  it('reports each write as it happens and still returns the complete text', async () => {
    const { seen, outcome } = await reported('echo one; echo two')
    expect(seen).toEqual([['stdout', 'one\n'], ['stdout', 'two\n']])
    expect(outcome.stdout).toBe('one\ntwo\n')
  })

  it('tags a diagnostic as standard error', async () => {
    const { seen, outcome } = await reported('definitely-not-a-program')
    expect(seen).toEqual([['stderr', 'bash: definitely-not-a-program: command not found\n']])
    expect(outcome).toEqual({ exitCode: 127, stdout: '', stderr: 'bash: definitely-not-a-program: command not found\n' })
  })

  it('reports only what the line writes out, not what it hands along or captures', async () => {
    // A pipeline stage writes into the next stage's input and a redirection
    // writes into a file: neither is output of the line, so a caller polling for
    // progress must not see it.
    const piped = await reported('cat notes.txt | cat')
    expect(piped.seen).toEqual([['stdout', 'alpha\n']])
    const redirected = await reported('echo captured > out.txt')
    expect(redirected.seen).toEqual([])
    expect(redirected.outcome.stdout).toBe('')
  })
})
