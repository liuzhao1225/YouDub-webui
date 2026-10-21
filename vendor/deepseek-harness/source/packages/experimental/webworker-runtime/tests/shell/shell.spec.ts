/**
 * The in-worker shell: structure (pipelines, chaining, subshells, redirections,
 * expansion) and the command table's effects on a real MemoryVfs.
 *
 * ONE module instance, like `../node/fs.spec.ts`: the command table reaches the VFS
 * through the module-level slot, so the mount here and the programs under test
 * must be the same copy of `src/storage/memory.ts`.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { MemoryVfs } from '@deepseek-ai/dsh-experimental-webworker-runtime/src/storage/memory.ts'
import { setActiveVfs } from '@deepseek-ai/dsh-experimental-webworker-runtime/src/storage/active.ts'
import { runShellCommand } from '@deepseek-ai/dsh-experimental-webworker-runtime/src/shell/interpret.ts'
import type { ShellRunOutcome } from '@deepseek-ai/dsh-experimental-webworker-runtime/src/shell/types.ts'

const WORKSPACE = '/dsh/workspace'

let vfs: MemoryVfs

/** Run one command line in a fresh workspace with a fixed environment. */
async function run(command: string, options: { stdin?: string; cwd?: string } = {}): Promise<ShellRunOutcome> {
  return await runShellCommand(command, {
    cwd: options.cwd ?? WORKSPACE,
    env: { HOME: '/dsh/home', PWD: WORKSPACE, GREETING: 'hello world' },
    stdin: options.stdin,
  })
}

beforeEach(() => {
  vfs = new MemoryVfs()
  setActiveVfs(vfs)
  vfs.mkdirSync(WORKSPACE, { recursive: true })
  vfs.mkdirSync(`${WORKSPACE}/src`, { recursive: true })
  vfs.writeFileSync(`${WORKSPACE}/notes.txt`, 'alpha\nbeta\ngamma\n')
  vfs.writeFileSync(`${WORKSPACE}/src/a.ts`, 'export const a = 1\n')
  vfs.writeFileSync(`${WORKSPACE}/src/b.ts`, 'export const b = 2\n')
})

describe('command execution', () => {
  it('runs a program and reports its output and status', async () => {
    expect(await run('echo hi')).toEqual({ exitCode: 0, stdout: 'hi\n', stderr: '' })
  })

  it('reports an unknown command the way a shell does', async () => {
    const result = await run('definitely-not-a-program --help')
    expect(result.exitCode).toBe(127)
    expect(result.stderr).toBe('bash: definitely-not-a-program: command not found\n')
  })

  it('reads a file through the VFS', async () => {
    expect((await run('cat notes.txt')).stdout).toBe('alpha\nbeta\ngamma\n')
  })

  it('reports a missing file as the utility does, with a nonzero status', async () => {
    const result = await run('cat missing.txt')
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toBe('cat: missing.txt: No such file or directory\n')
  })
})

describe('structure', () => {
  it('pipes standard output into the next stage', async () => {
    expect((await run('cat notes.txt | grep -n "^[ab]"')).stdout).toBe('1:alpha\n2:beta\n')
  })

  it('takes the pipeline status from its last stage', async () => {
    expect((await run('cat notes.txt | grep zeta')).exitCode).toBe(1)
  })

  it('honours && and || on the previous status', async () => {
    expect((await run('true && echo yes || echo no')).stdout).toBe('yes\n')
    expect((await run('false && echo yes || echo no')).stdout).toBe('no\n')
  })

  it('runs ; separated commands in order', async () => {
    expect((await run('echo one; echo two')).stdout).toBe('one\ntwo\n')
  })

  it('keeps a subshell directory change out of the parent', async () => {
    expect((await run('(cd src && pwd); pwd')).stdout).toBe(`${WORKSPACE}/src\n${WORKSPACE}\n`)
  })

  it('keeps a directory change made by the line itself', async () => {
    expect((await run('cd src; pwd')).stdout).toBe(`${WORKSPACE}/src\n`)
  })

  it('stops the line at exit and reports its status', async () => {
    const result = await run('echo before; exit 3; echo after')
    expect(result).toEqual({ exitCode: 3, stdout: 'before\n', stderr: '' })
  })
})

describe('redirections', () => {
  it('writes standard output to a file and truncates it first', async () => {
    await run('echo first > out.txt')
    await run('echo second > out.txt')
    expect(vfs.readFileSync(`${WORKSPACE}/out.txt`, 'utf8')).toBe('second\n')
  })

  it('creates an empty file when the command writes nothing', async () => {
    await run('true > empty.txt')
    expect(vfs.readFileSync(`${WORKSPACE}/empty.txt`, 'utf8')).toBe('')
  })

  it('appends with >>', async () => {
    await run('echo one > log.txt; echo two >> log.txt')
    expect(vfs.readFileSync(`${WORKSPACE}/log.txt`, 'utf8')).toBe('one\ntwo\n')
  })

  it('reads standard input from a file and from a here-string', async () => {
    expect((await run('grep beta < notes.txt')).stdout).toBe('beta\n')
    expect((await run('cat <<< inline')).stdout).toBe('inline\n')
  })

  it('sends standard error to its own file with 2>', async () => {
    const result = await run('cat missing.txt 2> err.txt')
    expect(result.stderr).toBe('')
    expect(vfs.readFileSync(`${WORKSPACE}/err.txt`, 'utf8')).toBe('cat: missing.txt: No such file or directory\n')
  })

  it('merges standard error into standard output with 2>&1', async () => {
    const result = await run('cat missing.txt 2>&1')
    expect(result.stderr).toBe('')
    expect(result.stdout).toBe('cat: missing.txt: No such file or directory\n')
  })

  it('reports a missing input file itself and never runs the command', async () => {
    // Setting up the redirection is the shell's own work, so the diagnostic is
    // prefixed `bash` on the resolved path rather than by the utility.
    expect(await run('cat < missing.txt')).toEqual({
      exitCode: 1,
      stdout: '',
      stderr: `bash: ${WORKSPACE}/missing.txt: No such file or directory\n`,
    })
  })

  it('refuses a target that expands to more than one word', async () => {
    const result = await run('cat < src/*.ts')
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toBe('bash: ambiguous redirect\n')
  })

  it('refuses a descriptor duplication other than between stdout and stderr', async () => {
    const result = await run('echo hi 3>&1')
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toBe('bash: 3>&1: unsupported descriptor redirection\n')
  })
})

describe('expansion', () => {
  it('expands variables, quoted and unquoted', async () => {
    expect((await run('echo "$GREETING"')).stdout).toBe('hello world\n')
    expect((await run('echo ${MISSING:-fallback}')).stdout).toBe('fallback\n')
  })

  it('reports the previous status as $?', async () => {
    expect((await run('false; echo $?')).stdout).toBe('1\n')
  })

  it('substitutes command output', async () => {
    expect((await run('echo "[$(head -n 1 notes.txt)]"')).stdout).toBe('[alpha]\n')
  })

  it('evaluates arithmetic', async () => {
    expect((await run('echo $((1 + 2 * 3))')).stdout).toBe('7\n')
  })

  it('expands globs against the VFS and keeps an unmatched pattern literal', async () => {
    expect((await run('echo src/*.ts')).stdout).toBe('src/a.ts src/b.ts\n')
    expect((await run('echo *.missing')).stdout).toBe('*.missing\n')
  })

  it('passes an assignment prefix as environment for that command only', async () => {
    expect((await run('MARK=set printenv MARK; echo "[${MARK}]"')).stdout).toBe('set\n[]\n')
  })
})

describe('file utilities', () => {
  it('lists a directory one entry per line', async () => {
    expect((await run('ls src')).stdout).toBe('a.ts\nb.ts\n')
  })

  it('creates, copies, moves, and removes trees', async () => {
    const result = await run('mkdir -p deep/nested && cp -r src deep/nested/copy && mv notes.txt deep/ && rm -r src')
    expect(result.exitCode).toBe(0)
    expect(vfs.existsSync(`${WORKSPACE}/deep/nested/copy/a.ts`)).toBe(true)
    expect(vfs.existsSync(`${WORKSPACE}/deep/notes.txt`)).toBe(true)
    expect(vfs.existsSync(`${WORKSPACE}/src`)).toBe(false)
  })

  it('finds by name and type', async () => {
    expect((await run('find . -name "*.ts"')).stdout).toBe('./src/a.ts\n./src/b.ts\n')
    expect((await run('find . -type d')).stdout).toBe('.\n./src\n')
  })

  it('counts, sorts, and deduplicates text', async () => {
    expect((await run('wc -l notes.txt')).stdout.trim()).toBe('3 notes.txt')
    expect((await run('sort -r notes.txt | head -n 1')).stdout).toBe('gamma\n')
    expect((await run('printf "b\\nb\\na\\n" | sort | uniq')).stdout).toBe('a\nb\n')
  })

  it('translates and deletes characters by range', async () => {
    expect((await run('echo shell-works | tr a-z A-Z')).stdout).toBe('SHELL-WORKS\n')
    expect((await run('echo a1b2c3 | tr -d 0-9')).stdout).toBe('abc\n')
  })

  it('substitutes with sed and refuses any other script', async () => {
    expect((await run('sed s/alpha/ALPHA/ notes.txt | head -n 1')).stdout).toBe('ALPHA\n')
    const refused = await run('sed 1d notes.txt')
    expect(refused.exitCode).toBe(2)
    expect(refused.stderr).toContain('only substitution scripts')
  })
})

describe('cancellation', () => {
  it('stops before the next command once the caller aborts', async () => {
    const controller = new AbortController()
    controller.abort()
    const result = await runShellCommand('echo never', {
      cwd: WORKSPACE,
      env: {},
      signal: controller.signal,
    })
    expect(result).toEqual({ exitCode: 130, stdout: '', stderr: '' })
  })
})
