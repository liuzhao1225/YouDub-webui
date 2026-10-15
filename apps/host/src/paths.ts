import { resolve, join } from 'node:path'
import { homedir } from 'node:os'

export function runtimePaths(dataDirectory = process.env.YOUDUB_DESKTOP_DATA_DIR) {
  const base = process.platform === 'darwin' ? join(homedir(), 'Library/Application Support/YouDub')
    : process.platform === 'win32' ? join(process.env.LOCALAPPDATA || homedir(), 'YouDub')
      : join(process.env.XDG_DATA_HOME || join(homedir(), '.local/share'), 'youdub')
  const environment = process.env.YOUDUB_PYTHON_ENV_DIR || '.venv'
  return { root: resolve(dataDirectory || base), repoRoot: resolve('.'), python: resolve(process.env.YOUDUB_PYTHON || join(environment, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')) }
}
