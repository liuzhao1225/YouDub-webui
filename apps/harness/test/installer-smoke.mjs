/** Exercise the Windows installer and its installed payload on the release runner. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { access, mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

if (process.platform !== 'win32') throw new Error('Windows installer smoke test requires Windows.');
const version = JSON.parse(await readFile(new URL('../../../package.json', import.meta.url), 'utf8')).version;
const installer = resolve(process.argv[2] || `dist/YouDub-${version}-windows-x64-Setup.exe`);
const directory = await mkdtemp(join(tmpdir(), 'YouDub installed '));
const application = join(directory, 'YouDub');
execFileSync(installer, ['/S', `/D=${application}`], { timeout: 120_000, stdio: 'inherit' });
await access(join(application, 'YouDub.exe'));
execFileSync(process.execPath, [join(import.meta.dirname, 'package-smoke.mjs'), application,
  resolve('dist/package-smoke-windows-installed')], { timeout: 180_000, stdio: 'inherit' });
const uninstaller = (await readdir(application)).find(name => /^Uninstall.*\.exe$/i.test(name));
assert(uninstaller, 'NSIS uninstaller missing');
execFileSync(join(application, uninstaller), ['/S'], { timeout: 120_000, stdio: 'inherit' });
const deadline = Date.now() + 30_000;
while (true) {
  try { await access(join(application, 'YouDub.exe')); }
  catch (error) { if (error.code === 'ENOENT') break; throw error; }
  if (Date.now() > deadline) throw new Error('Uninstaller did not remove the application executable');
  await delay(200);
}
console.log('Windows installer: install, relocated application launch, and uninstall passed.');
