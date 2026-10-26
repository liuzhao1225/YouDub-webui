/** Exercise the Windows installer and its installed payload on the release runner. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { access, mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

if (process.platform !== 'win32') throw new Error('Windows installer smoke test requires Windows.');
const version = JSON.parse(await readFile(new URL('../../../package.json', import.meta.url), 'utf8')).version;
const installer = resolve(process.argv[2] || `dist/YouDub-${version}-windows-x64-Setup.exe`);
const directory = await mkdtemp(join(tmpdir(), 'YouDub installed '));
const application = join(directory, 'YouDub');
const state = join(directory, 'user state');
const registration = () => JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
  "$key = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{C28A6869-1C98-4FA0-BBE5-E5C579B0A602}_is1'; if (Test-Path $key) { Get-ItemProperty $key | Select-Object DisplayName,InstallLocation | ConvertTo-Json -Compress } else { 'null' }"], { encoding: 'utf8' }));
const install = () => execFileSync(installer, ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-', `/DIR=${application}`], { timeout: 120_000, stdio: 'inherit' });
const smoke = (name, ...args) => execFileSync(process.execPath, [join(import.meta.dirname, 'package-smoke.mjs'), application,
  resolve(`dist/package-smoke-windows-installed/${name}`), '--in-place', `--state-dir=${state}`, ...args], { timeout: 180_000, stdio: 'inherit' });
install();
await access(join(application, 'YouDub.exe'));
assert.equal(registration().DisplayName, 'YouDub');
assert.equal(resolve(registration().InstallLocation), application);
smoke('clean');
const home = join(state, 'user data/harness');
const patch = join(home, 'profiles/desktop/cordis.patch.yml');
const files = new Map([[patch, await readFile(patch)],
  [join(home, '.credentials.yaml'), Buffer.from('# YouDub saved credentials\nrefs: {}\n')],
  [join(state, 'YouDub media/models/preserved-model.bin'), Buffer.from('existing model')],
  [join(state, 'YouDub media/tasks/preserved-task.txt'), Buffer.from('existing task')]]);
for (const [file, value] of files) {
  await mkdir(resolve(file, '..'), { recursive: true });
  await writeFile(file, value);
}
// Previous versions may have shipped a nested dependency which the new payload
// no longer lists. A plain recursive overwrite leaves this code executable.
const obsolete = join(application, 'resources/app/node_modules/@deepseek-ai/dsh-config-editor/node_modules/obsolete-boot');
await mkdir(obsolete, { recursive: true });
await writeFile(join(obsolete, 'index.js'), 'throw new Error("Obsolete upgrade dependency was loaded")');
install();
await assert.rejects(access(obsolete), { code: 'ENOENT' });
for (const [file, value] of files) assert.deepEqual(await readFile(file), value, `Upgrade changed user data: ${file}`);
smoke('upgrade', '--configured');
for (const [file, value] of files) assert.deepEqual(await readFile(file), value, `Restart changed saved data: ${file}`);
const uninstaller = (await readdir(application)).find(name => /^unins\d+\.exe$/i.test(name));
assert(uninstaller, 'Inno Setup uninstaller missing');
execFileSync(join(application, uninstaller), ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART'], { timeout: 120_000, stdio: 'inherit' });
const deadline = Date.now() + 30_000;
while (true) {
  try { await access(join(application, 'YouDub.exe')); }
  catch (error) { if (error.code === 'ENOENT') break; throw error; }
  if (Date.now() > deadline) throw new Error('Uninstaller did not remove the application executable');
  await delay(200);
}
for (const [file, value] of files) assert.deepEqual(await readFile(file), value, `Uninstall removed user data: ${file}`);
assert.equal(registration(), null, 'YouDub uninstall registration must be removed with its application');
console.log('Windows installer: in-place Chinese setup, overwrite upgrade, data preservation, Harness isolation, restart and uninstall passed.');
