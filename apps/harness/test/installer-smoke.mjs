/** Exercise the Windows installer and its installed payload on the release runner. */
import assert from 'node:assert/strict';
import { execFile, execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { access, mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';

if (process.platform !== 'win32') throw new Error('Windows installer smoke test requires Windows.');
const version = JSON.parse(await readFile(new URL('../../../package.json', import.meta.url), 'utf8')).version;
const arguments_ = process.argv.slice(2);
const previousArguments = arguments_.filter(value => value.startsWith('--previous-installer='));
const positionalArguments = arguments_.filter(value => !value.startsWith('--'));
assert(previousArguments.length <= 1 && positionalArguments.length <= 1
  && arguments_.length === previousArguments.length + positionalArguments.length,
  'Usage: installer-smoke.mjs [candidate-installer] [--previous-installer=<path>]');
const previousPath = previousArguments[0]?.slice('--previous-installer='.length);
assert(previousPath !== '', '--previous-installer requires a path.');
const previousInstaller = previousPath === undefined ? undefined : resolve(previousPath);
const installer = resolve(positionalArguments[0] || `dist/YouDub-${version}-windows-x64-Setup.exe`);
const directory = await mkdtemp(join(tmpdir(), 'YouDub installed '));
const application = join(directory, 'YouDub');
const state = join(directory, 'user state');
const evidence = resolve(previousInstaller ? 'dist/package-smoke-windows-previous-upgrade' : 'dist/package-smoke-windows-installed');
await mkdir(evidence, { recursive: true });
const result = { scenario: previousInstaller ? 'previous-version-upgrade' : 'fresh-install', status: 'incomplete',
  application, candidateInstaller: installer, candidateVersion: version,
  ...(previousInstaller ? { previousInstaller, previousExpectedVersion: '0.0.9', previousApplicationStarted: false } : {}),
  installations: [], checks: {} };
const saveResult = () => writeFile(join(evidence, 'installer-result.json'), JSON.stringify(result, null, 2) + '\n');
await saveResult();
const registration = () => JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
  "$key = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{C28A6869-1C98-4FA0-BBE5-E5C579B0A602}_is1'; if (Test-Path $key) { Get-ItemProperty $key | Select-Object DisplayName,DisplayVersion,InstallLocation | ConvertTo-Json -Compress } else { 'null' }"], { encoding: 'utf8' }));
async function runStep(name, executable, args, timeout) {
  console.log(`Windows installer: ${name} started.`);
  const log = args.find(value => value.startsWith('/LOG='))?.slice(5);
  let previous = '';
  const progress = log && setInterval(() => {
    if (!existsSync(log)) { console.log(`Windows installer: ${name} is waiting for its log file.`); return; }
    const tail = readFileSync(log, 'utf8').split('\n').slice(-8).join('\n');
    if (tail !== previous) { console.log(tail); previous = tail; }
    else console.log(`Windows installer: ${name} is still running; log unchanged.`);
  }, 5_000);
  try {
    const pending = promisify(execFile)(executable, args, { timeout });
    console.log(`Windows installer: ${name} spawned process ${pending.child.pid}.`);
    const result = await pending;
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
  } catch (error) {
    console.error(`Windows installer: ${name} failed. Diagnostic logs: ${evidence}`);
    if (error.stdout) process.stdout.write(error.stdout);
    if (error.stderr) process.stderr.write(error.stderr);
    if (log && existsSync(log)) console.error(readFileSync(log, 'utf8').split('\n').slice(-40).join('\n'));
    throw error;
  } finally {
    if (progress) clearInterval(progress);
  }
  console.log(`Windows installer: ${name} finished.`);
}
const install = (name, executable = installer) => runStep(name, executable, ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-',
  `/DIR=${application}`, `/LOG=${join(evidence, `${name}.log`)}`], 120_000);
const smoke = (name, ...args) => runStep(`${name} launch`, process.execPath, [join(import.meta.dirname, 'package-smoke.mjs'), application,
  join(evidence, name), '--in-place', `--state-dir=${state}`, ...args], 180_000);
async function verifyInstallation(phase, executable, expectedVersion) {
  await access(join(application, 'YouDub.exe'));
  const manifestPath = join(application, 'resources/app/package.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const registered = registration();
  assert(registered, `${phase}: YouDub uninstall registration is missing.`);
  assert.match(registered.DisplayName, /^YouDub\b/);
  assert.equal(registered.DisplayVersion, expectedVersion);
  assert.equal(resolve(registered.InstallLocation), application);
  assert.equal(manifest.version, expectedVersion, `${phase}: installed application version differs from the installer.`);
  result.installations.push({ phase, installer: executable, registration: registered,
    manifest: { path: manifestPath, name: manifest.name, version: manifest.version, main: manifest.main } });
  await saveResult();
}
if (previousInstaller) {
  assert.equal(registration(), null, 'Previous installer scenario requires the first scenario to have uninstalled YouDub.');
  await install('previous-install', previousInstaller);
  await verifyInstallation('previous-install', previousInstaller, '0.0.9');
  // Never launch the old application: first configuration belongs to the new
  // candidate after it has replaced the real previous version's payload.
  await install('current-over-previous');
  await verifyInstallation('current-over-previous', installer, version);
} else {
  await install('clean-install');
  await verifyInstallation('clean-install', installer, version);
}
await smoke('clean');
const home = join(state, 'user data/harness');
const patch = join(home, 'profiles/desktop/cordis.patch.yml');
const files = new Map([[patch, await readFile(patch)],
  [join(home, '.credentials.yaml'), await readFile(join(home, '.credentials.yaml'))],
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
await install('overwrite-install');
await verifyInstallation('overwrite-install', installer, version);
await assert.rejects(access(obsolete), { code: 'ENOENT' });
for (const [file, value] of files) assert((await readFile(file)).equals(value), `Upgrade changed user data: ${file}`);
// The automatic-install entry must wait for the old PID, replace code, and relaunch
// with the same user-data directory. A controlled process holds the old PID here;
// real Host/task admission and updater download are exercised by their integration tests.
const parent = spawn(process.execPath, ['-e', "process.stdin.once('data', () => process.exit(0)); setInterval(() => {}, 1000)"], { stdio: ['pipe', 'ignore', 'inherit'] });
const automaticLog = join(evidence, 'automatic-install.log');
const updateUserData = join(directory, 'automatic update user data');
await mkdir(obsolete, { recursive: true });
await writeFile(join(obsolete, 'index.js'), '// obsolete application code');
const automatic = runStep('automatic-install', installer, ['/VERYSILENT', '/NORESTART', '/SP-', '/YOUDUBUPDATE=1',
  '/UPDATEPID=' + parent.pid, '/UPDATEUSERDATA=' + updateUserData, '/DIR=' + application, '/LOG=' + automaticLog], 120_000);
// Observe rejection immediately while waiting for the installer to reach its PID gate.
let automaticFailure;
void automatic.catch(error => { automaticFailure = error });
try {
  const deadline = Date.now() + 20_000;
  while (!existsSync(automaticLog) || !readFileSync(automaticLog, 'utf8').includes('YouDub update: waiting for application process')) {
    if (automaticFailure) throw automaticFailure;
    if (Date.now() > deadline) throw new Error('Automatic installer did not reach its old-process gate');
    await delay(200);
  }
  await access(obsolete);
  parent.stdin.end('exit');
  await automatic;
  await verifyInstallation('automatic-install', installer, version);
  await assert.rejects(access(obsolete), { code: 'ENOENT' });
  // Inno [Run] owns restart. Verify the real new process and close its idle first-run window normally.
  await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    '$ErrorActionPreference = "Stop"; $deadline = (Get-Date).AddSeconds(45); do { $p = Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $env:YOUDUB_INSTALLED_EXE -and $_.CommandLine -like "*--updated*" -and $_.CommandLine -notlike "*--type=*" }; if ($p) { break }; Start-Sleep -Milliseconds 200 } while ((Get-Date) -lt $deadline); if (-not $p) { throw "Updated application did not relaunch" }; if (-not $p.CommandLine.Contains($env:YOUDUB_UPDATE_USER_DATA)) { throw "Updated application changed user data directory" }; $process = Get-Process -Id $p.ProcessId; do { $process.Refresh(); if ($process.MainWindowHandle -ne 0) { break }; Start-Sleep -Milliseconds 200 } while ((Get-Date) -lt $deadline); $heldHandle = $process.Handle; if (-not $process.CloseMainWindow()) { throw "Updated application did not show its window" }; if (-not $process.WaitForExit(30000)) { throw "Updated application did not close cleanly" }; if ($process.ExitCode -ne 0) { throw ("Updated application failed; exit code: " + $process.ExitCode + "; process handle: " + $heldHandle) }'],
    { env: { ...process.env, YOUDUB_INSTALLED_EXE: join(application, 'YouDub.exe'), YOUDUB_UPDATE_USER_DATA: updateUserData }, timeout: 90_000 });
  result.checks.automaticWaitAndRelaunch = true;
  await saveResult();
} finally {
  if (parent.exitCode === null) parent.stdin.end('exit');
}
await smoke('upgrade', '--configured');
for (const [file, value] of files) assert((await readFile(file)).equals(value), `Restart changed saved data: ${file}`);
const uninstaller = (await readdir(application)).find(name => /^unins\d+\.exe$/i.test(name));
assert(uninstaller, 'Inno Setup uninstaller missing');
await runStep('uninstall', join(application, uninstaller), ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART',
  `/LOG=${join(evidence, 'uninstall.log')}`], 120_000);
const deadline = Date.now() + 30_000;
while (true) {
  try { await access(join(application, 'YouDub.exe')); }
  catch (error) { if (error.code === 'ENOENT') break; throw error; }
  if (Date.now() > deadline) throw new Error('Uninstaller did not remove the application executable');
  await delay(200);
}
for (const [file, value] of files) assert((await readFile(file)).equals(value), `Uninstall removed user data: ${file}`);
assert.equal(registration(), null, 'YouDub uninstall registration must be removed with its application');
result.status = 'passed';
result.checks = { ...result.checks, chineseFirstConfiguration: true, overwrite: true, obsoleteCodeRemoved: true,
  dataPreservation: true, restart: true, uninstall: true };
await saveResult();
console.log('Windows installer: in-place Chinese setup, overwrite upgrade, data preservation, Harness isolation, restart and uninstall passed.');
