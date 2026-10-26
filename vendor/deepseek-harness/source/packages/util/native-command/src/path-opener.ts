/** Cross-platform configuration-file opener used by the Host settings API. */

import { release as osRelease } from 'node:os'
import { pathToFileURL } from 'node:url'
import { runNativeCommand, type NativeCommandRunner } from './runner.ts'

/** Testable command boundary; native implementations never invoke a shell. */
export type PathOpenerRunner = NativeCommandRunner

/** Injectable platform facts for deterministic adapter tests. */
export interface PathOpenerInternals {
  platform?: NodeJS.Platform
  /** Kernel release override used to distinguish WSL from desktop Linux. */
  osRelease?: string
  /** Environment used for WSL markers. */
  env?: NodeJS.ProcessEnv
  run?: PathOpenerRunner
}

/** Whether one environment marker is set to a non-empty value. */
function present(value: string | undefined): boolean {
  return value !== undefined && value !== ''
}

/** Distinguish WSL from desktop Linux using its process and kernel markers. */
function isWsl(internals: PathOpenerInternals): boolean {
  const env = internals.env ?? process.env
  if (present(env.WSL_DISTRO_NAME) || present(env.WSL_INTEROP)) return true
  return (internals.osRelease ?? osRelease()).toLowerCase().includes('microsoft')
}

/**
 * Encode one Windows path as the target Explorer can receive intact.
 *
 * Explorer parses its own command line and splits fields at commas and equals
 * signs, so a raw path loses everything after the first separator and the shell
 * opens a different target without reporting it; both separators are escaped.
 * Nothing else is: Explorer rejects percent-encoded non-ASCII in a file URI and
 * opens the user's Documents folder instead, while it resolves the literal
 * characters, so Node's non-ASCII escapes are decoded back and its ASCII escapes
 * stand. Node resolves the path before encoding it, so a verbatim `\\?\` or
 * `\\?\UNC\` prefix reaches Explorer as the ordinary drive or UNC URI; a `\\.\`
 * device path keeps that same UNC handling and names a device rather than a
 * shell item, which this opener does not open.
 * @param windowsPath - path already translated for the Windows desktop.
 * @returns the target for a file open.
 */
function explorerTarget(windowsPath: string): string {
  const href = pathToFileURL(windowsPath, { windows: true }).href
  // A run of escapes whose every byte starts above ASCII is one non-ASCII character.
  return href
    .replace(/(?:%[89A-F][0-9A-F])+/gi, escaped => decodeURIComponent(escaped))
    .replaceAll(',', '%2C')
    .replaceAll('=', '%3D')
}

/**
 * Hand one target to Explorer, accepting its delegated-handoff exit code.
 *
 * Explorer exits 1 after handing the request to the desktop process already
 * running, so exit 1 means the shell took it. Every other failure still
 * rejects, and cancellation wins over a delegate's exit 1.
 * @param args - Explorer argv: the encoded target to open.
 * @param signal - caller lifetime; abort terminates the command.
 * @param run - shell-free command runner.
 * @throws The runner's failure unless it is Explorer's delegate exit 1.
 */
async function runExplorer(args: readonly string[], signal: AbortSignal, run: PathOpenerRunner): Promise<void> {
  try {
    // SW_HIDE also hides Explorer's folder window, not just console windows.
    await run('explorer.exe', args, signal, 'visible')
  } catch (error: unknown) {
    signal.throwIfAborted()
    // Explorer can exit 1 after delegating to the existing desktop process.
    if (!(error instanceof Error) || !('code' in error) || error.code !== 1) throw error
  }
}

/**
 * Open one Windows-resolvable path through Explorer, the shell that owns the
 * default-application resolution a double-click uses.
 * @param path - Windows-resolvable path; Explorer receives its encoded file URI as one argv element, never a command string.
 * @param signal - caller lifetime; abort terminates the command.
 * @param run - shell-free command runner.
 */
async function openWindowsPath(path: string, signal: AbortSignal, run: PathOpenerRunner): Promise<void> {
  await runExplorer([explorerTarget(path)], signal, run)
}

/** Translate a WSL path before handing it to the Windows desktop. */
async function openWslPath(path: string, signal: AbortSignal, run: PathOpenerRunner): Promise<void> {
  const translated = await run('wslpath', ['-w', path], signal, 'hidden')
  signal.throwIfAborted()
  const windowsPath = translated.stdout.replace(/[\r\n]+$/, '')
  if (windowsPath === '') throw new Error('wslpath returned no Windows path')
  await openWindowsPath(windowsPath, signal, run)
}

/** Open a configuration document through a shell-free platform command. */
export async function openNativeTextFile(
  path: string,
  signal: AbortSignal,
  internals: PathOpenerInternals = {},
): Promise<void> {
  const platform = internals.platform ?? process.platform
  const run = internals.run ?? runNativeCommand
  const wsl = platform === 'linux' && isWsl(internals)

  if (platform === 'darwin') {
    await run('open', ['-t', path], signal, 'hidden')
    return
  }

  if (platform === 'win32') {
    await openWindowsPath(path, signal, run)
    return
  }

  if (platform === 'linux') {
    if (wsl) {
      await openWslPath(path, signal, run)
      return
    }
    await run('xdg-open', [path], signal, 'hidden')
    return
  }

  throw new Error(`native path opener is unsupported on ${platform}`)
}
