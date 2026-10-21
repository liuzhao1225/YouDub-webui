import { spawnSync } from 'node:child_process'
import { isAbsolute, resolve } from 'node:path'

export function smokePython() {
  const python = process.env.YOUDUB_TEST_PYTHON
  if (!python || !isAbsolute(python)) throw new Error('Set YOUDUB_TEST_PYTHON to an absolute Python 3.12 executable with backend/requirements/base.txt installed. No models are required.')
  const result = spawnSync(python, ['-c', 'import sys; assert sys.version_info[:2] == (3, 12), "Python 3.12 is required"; from backend.workers.setup_probe import verify; verify(["base"])'], { cwd: resolve(import.meta.dirname, '..'), encoding: 'utf8', windowsHide: true, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`Desktop smoke Python is not ready: ${result.stderr}`)
  return python
}
