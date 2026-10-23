/** Launch a relocated installed application with a clean profile and inspect the real renderer. */
import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { access, cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const source = resolve(process.argv[2]);
const workbench = process.argv.includes('--workbench');
const evidence = resolve(process.argv[3] || 'dist/package-smoke');
await mkdir(evidence, { recursive: true });
const temporary = await mkdtemp(join(tmpdir(), 'YouDub package smoke '));
const destination = join(temporary, basename(source));
await cp(source, destination, { recursive: true, verbatimSymlinks: true });
const installed = await realpath(destination);
const resources = join(installed, ...(process.platform === 'darwin' ? ['Contents', 'Resources'] : ['resources']));
const runtime = join(resources, 'app');
const appManifest = JSON.parse(await readFile(join(runtime, 'package.json'), 'utf8'));
async function verifyLinks(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    assert(!['.env', 'env.txt', '.venv', '.git'].includes(entry.name), `Private development file in package: ${path}`);
    if (entry.isSymbolicLink()) assert((await realpath(path)).startsWith(installed + sep), `Package links outside itself: ${path}`);
    else if (entry.isDirectory()) await verifyLinks(path);
  }
}
await verifyLinks(installed);
const executable = join(installed, ...(process.platform === 'darwin' ? ['Contents', 'MacOS', 'YouDub'] : ['YouDub.exe']));
const environment = { ...process.env, DSH_HOME: join(temporary, 'home') };
for (const name of ['ELECTRON_RUN_AS_NODE', 'YOUDUB_TEST_SKIP_SETUP', 'YOUDUB_TEST_PYTHON', 'NODE_PATH',
  'DSH_DESKTOP_DSH_DIR', 'DSH_DESKTOP_PNPM_ENTRY', 'YOUDUB_HARNESS_PLUGIN_ROOT', 'YOUDUB_MEDIA_ROOT']) delete environment[name];
if (workbench) {
  environment.YOUDUB_TEST_SKIP_SETUP = '1';
  environment.YOUDUB_TEST_PYTHON = process.env.YOUDUB_TEST_PYTHON || resolve('.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  await access(environment.YOUDUB_TEST_PYTHON);
}
const application = await electron.launch({ executablePath: executable,
  args: [`--user-data-dir=${join(temporary, 'user data')}`], cwd: temporary, env: environment, timeout: 90_000 });
const child = application.process();
const exited = once(child, 'exit');
let output = '', complete = false;
child.stdout.on('data', value => { output += value; });
child.stderr.on('data', value => { output += value; });
try {
  const page = await application.firstWindow({ timeout: 30_000 });
  await page.waitForURL('dsh-app://app/');
  await page.waitForFunction(() => document.body?.innerText?.length > 40);
  await page.screenshot({ path: join(evidence, 'first-launch.png') });
  await writeFile(join(evidence, 'rendered.txt'), await page.locator('body').innerText());
  const evaluate = expression => page.evaluate(expression);
  // First startup must reach real setup without a system Python, project checkout, or test bypass.
  const setup = await evaluate(`(async () => {
    const response = await fetch('/api/youdub/v2', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({method:'GET',path:'/api/setup'}) });
    if(!response.ok) throw new Error('Setup API HTTP ' + response.status + ': ' + await response.text());
    return response.json();
  })()`);
  assert.equal(setup.phase, workbench ? 'skipped' : 'installation', setup.error);
  assert.equal(setup.version, appManifest.version);
  assert.equal(setup.testMode, workbench ? true : undefined);
  assert.equal(setup.environment.length, 0);
  const text = await evaluate('document.body.innerText');
  assert.match(text, workbench ? /工作台|Workbench/ : /安装|Install|installation|开始|Get started/);
  if (workbench) {
    const tasks = await evaluate(`(async () => {
      const response = await fetch('/api/youdub/v2', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({method:'GET',path:'/api/v2/tasks'}) });
      return {status:response.status, body:await response.text()};
    })()`);
    assert.equal(tasks.status, 200, tasks.body);
  }
  const sample = await evaluate(`(async () => {
    const response = await fetch('/api/youdub/examples/assets/zoo-en.mp4', {headers:{Range:'bytes=0-1023'}});
    return {status:response.status, bytes:(await response.arrayBuffer()).byteLength};
  })()`);
  assert.equal(sample.status, 206);
  assert.equal(sample.bytes, 1024);
  await page.screenshot({ path: join(evidence, 'first-launch.png') });
  await writeFile(join(evidence, 'result.json'), JSON.stringify({ version: appManifest.version, platform: process.platform,
    arch: process.arch, relocated: true, setupPhase: setup.phase, demoRange: sample, renderedText: text }, null, 2) + '\n');
  await Promise.race([application.close(), delay(20_000, undefined, { ref: false }).then(() => { throw new Error('Packaged application quit timed out'); })]);
  const [code, signal] = await Promise.race([exited, delay(15_000, undefined, { ref: false }).then(() => { throw new Error('Packaged application did not exit cleanly'); })]);
  assert.equal(signal, null);
  assert.equal(code, 0);
  if (process.platform === 'darwin') execFileSync('codesign', ['--verify', '--deep', '--strict', installed], { stdio: 'pipe' });
  complete = true;
  console.log(`Packaged YouDub ${appManifest.version}: relocated ${workbench ? 'workbench and Python worker' : 'first setup'}, embedded demo and clean exit passed.`);
} finally {
  if (!complete && child.exitCode === null) child.kill('SIGKILL');
  // Preserve diagnostic evidence privately. Local launch tokens are redacted before persistence.
  if (complete) await rm(temporary, { recursive: true });
  await writeFile(join(evidence, 'launch.log'), output.replace(/(token[=:]\s*)[^\s&"']+/gi, '$1[redacted]'), { mode: 0o600 });
}
