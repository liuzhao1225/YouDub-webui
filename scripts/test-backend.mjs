import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const python = process.env.YOUDUB_TEST_PYTHON || resolve('.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
const result = spawnSync(python, ['-m', 'pytest', 'backend/tests', ...process.argv.slice(2)], {
  stdio: 'inherit', windowsHide: true, env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
})
if (result.error) throw result.error
process.exitCode = result.status ?? 1
