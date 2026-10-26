/** Resolve the framework build package manager without a shell. */
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Resolve pnpm as a command prefix that spawns without a shell. On Windows the
 * `pnpm` shim is a `.cmd` batch file, which `spawnSync` refuses to run unless a
 * shell interprets it, so the prefix runs pnpm's JavaScript entry with the
 * current Node instead: the entry that launched this script when a run-script
 * did, or the workspace's own pnpm dependency otherwise. pnpm's manifest does
 * not export its bin entry, so the dependency is located on disk rather than
 * through module resolution.
 * @returns Command and leading arguments to prepend before pnpm's arguments.
 */
export function pnpmCommand(): readonly [command: string, ...args: string[]] {
  const execpath = process.env.npm_execpath
  // `npm run` and `yarn run` set this too, and handing pnpm's arguments to either would write a different lockfile.
  if (execpath !== undefined && /[\\/]pnpm[\\/]/u.test(execpath) && /\.[cm]?js$/u.test(execpath)) return [process.execPath, execpath]
  for (let directory = dirname(fileURLToPath(import.meta.url)); ; directory = dirname(directory)) {
    const entry = join(directory, 'node_modules', 'pnpm', 'bin', 'pnpm.cjs')
    if (existsSync(entry)) return [process.execPath, entry]
    if (dirname(directory) === directory) break
  }
  // Windows resolves a bare `pnpm` to a batch shim that spawnSync cannot start, so say that rather than fail later.
  if (process.platform === 'win32') {
    throw new Error('release: cannot locate pnpm\'s JavaScript entry; run this through a pnpm script or install workspace dependencies')
  }
  return ['pnpm']
}
