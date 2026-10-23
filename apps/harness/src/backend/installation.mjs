import { access, mkdir, readdir, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { isAbsolute, join, parse, resolve } from 'node:path';
import { homedir } from 'node:os';
import { AppError } from '../../../../packages/sdk/src/index.ts';

export const privatePython = root => join(root, 'runtime', 'venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');

/** Existing installations retain their explicit runtime paths and task data. */
export async function existingInstallation(root) {
  try {
    const entries = await readdir(root);
    return entries.some(name => ['desktop.sqlite', 'runtime', 'models', 'tasks'].includes(name));
  } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

/** Validate before persisting the choice or starting any download. */
export async function installationDirectory(value) {
  if (typeof value !== 'string' || !value.trim() || !isAbsolute(value) || value.includes('\0')) {
    throw new AppError('INVALID_INSTALL_DIRECTORY', '请选择绝对路径的安装目录。', 422);
  }
  const path = resolve(value);
  if (path === parse(path).root || path === homedir()) {
    throw new AppError('INVALID_INSTALL_DIRECTORY', '请为 YouDub 选择独立的文件夹。', 422);
  }
  await mkdir(path, { recursive: true });
  await access(path, constants.W_OK);
  return realpath(path);
}
