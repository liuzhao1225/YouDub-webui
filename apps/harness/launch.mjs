import { mkdir, symlink, lstat, realpath } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { initProfile } from '@deepseek-ai/dsh-app-boot';

// Only compose and launch an official Harness profile. Configuration is owned
// by Harness: bundle defaults -> profile patch -> home patch -> --patch.
const here = fileURLToPath(new URL('.', import.meta.url));
const home = resolve(process.env.DSH_HOME || resolve(here, '../../.cache/harness/dsh'));
const profile = resolve(home, 'profiles/youdub');
initProfile(profile, ['@youdub/harness-subtitles']);
const link = resolve(profile, 'node_modules/@youdub/harness-subtitles');
await mkdir(dirname(link), { recursive: true });
try {
  await lstat(link);
  if (await realpath(link) !== await realpath(here)) throw new Error(`Profile plugin link points to another checkout: ${link}`);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  await symlink(here, link, 'dir');
}
const child = spawn(process.execPath, [resolve(here, 'node_modules/@deepseek-ai/dsh/lib/bin.js'), '--profile', 'youdub', ...process.argv.slice(2)], {
  cwd: here, stdio: 'inherit', env: { ...process.env, DSH_HOME: home },
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.once('error', error => { console.error(error); process.exitCode = 1; });
child.once('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
