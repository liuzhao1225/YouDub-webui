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
const inPlace = process.argv.includes('--in-place');
const configured = process.argv.includes('--configured');
const stateDirectory = process.argv.find(value => value.startsWith('--state-dir='))?.slice('--state-dir='.length);
const evidence = resolve(process.argv[3] || 'dist/package-smoke');
await mkdir(evidence, { recursive: true });
const temporary = stateDirectory ? resolve(stateDirectory) : await mkdtemp(join(tmpdir(), 'YouDub package smoke '));
await mkdir(temporary, { recursive: true });
const destination = inPlace ? source : join(temporary, basename(source));
if (!inPlace) await cp(source, destination, { recursive: true, verbatimSymlinks: true });
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
const harnessHome = join(temporary, 'DeepSeek Harness home');
await mkdir(harnessHome, { recursive: true });
const sentinel = '# Harness credentials must stay untouched\nrefs: {}\n';
await writeFile(join(harnessHome, '.credentials.yaml'), sentinel);
const userData = join(temporary, 'user data');
const youdubHome = join(userData, 'harness');
const environment = { ...process.env, DSH_HOME: harnessHome,
  DSH_DESKTOP_DSH_DIR: join(temporary, 'missing Harness runtime'), DSH_DESKTOP_PRIMARY_RUNTIME_DIR: harnessHome };
for (const name of ['ELECTRON_RUN_AS_NODE', 'YOUDUB_TEST_SKIP_SETUP', 'YOUDUB_TEST_PYTHON', 'NODE_PATH',
  'YOUDUB_HOME', 'YOUDUB_HARNESS_PLUGIN_ROOT', 'YOUDUB_MEDIA_ROOT']) delete environment[name];
if (workbench) {
  environment.YOUDUB_TEST_SKIP_SETUP = '1';
  environment.YOUDUB_TEST_PYTHON = process.env.YOUDUB_TEST_PYTHON || resolve('.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  await access(environment.YOUDUB_TEST_PYTHON);
}
const application = await electron.launch({ executablePath: executable,
  args: [`--user-data-dir=${userData}`, '--lang=zh-CN'], cwd: temporary, env: environment, timeout: 90_000 });
const child = application.process();
// Windows keeps executable handles until child streams close after process exit.
const closed = once(child, 'close');
let output = '', complete = false;
child.stdout.on('data', value => { output += value; });
child.stderr.on('data', value => { output += value; });
try {
  const ownership = await application.evaluate(({ app }) => ({
    name: app.getName(), home: process.env.DSH_HOME, runtime: process.env.DSH_DESKTOP_DSH_DIR,
    primaryRuntime: process.env.DSH_DESKTOP_PRIMARY_RUNTIME_DIR, userData: app.getPath('userData'),
  }));
  assert.equal(ownership.name, 'YouDub');
  assert.equal(ownership.home, youdubHome);
  assert.equal(ownership.userData, userData);
  assert.equal(await realpath(ownership.runtime), await realpath(runtime));
  assert.equal(ownership.primaryRuntime, undefined);
  // Accept only the explicit quit confirmation; startup failures retain their real dialogs.
  await application.evaluate(({ dialog }) => {
    const original = dialog.showMessageBox;
    dialog.showMessageBox = (...args) => {
      const options = args.at(-1);
      if (/退出 YouDub|Quit YouDub|YouDub を終了/.test(options.message)) return Promise.resolve({ response: 0, checkboxChecked: false });
      return original(...args);
    };
  });
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
  if (configured) {
    assert.notEqual(setup.phase, 'installation', 'Saved installation must survive restart/upgrade');
    assert.equal(await realpath(setup.installation.path), await realpath(join(temporary, 'YouDub media')));
  } else assert.equal(setup.phase, workbench ? 'skipped' : 'installation', setup.error);
  assert.equal(setup.version, appManifest.version);
  assert.equal(setup.testMode, workbench ? true : undefined);
  if (!configured) assert.equal(setup.environment.length, 0);
  const text = await evaluate('document.body.innerText');
  if (!configured) assert.match(text, workbench ? /工作台|Workbench/ : /安装|Install|installation|开始|Get started/);
  if (workbench) {
    const tasks = await evaluate(`(async () => {
      const response = await fetch('/api/youdub/v2', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({method:'GET',path:'/api/v2/tasks'}) });
      return {status:response.status, body:await response.text()};
    })()`);
    assert.equal(tasks.status, 200, tasks.body);
    await page.getByRole('button', { name: /使用黄仁勋采访视频|Use Jensen Huang interview/ }).click();
    await page.getByText('jensen-en.mp4', { exact: true }).waitFor();
    assert.equal(await page.getByRole('link', { name: /查看官网示例|View website examples/ }).getAttribute('href'), 'https://liuzhao1225.github.io/YouDub-webui/#demo');
  }
  const sample = await evaluate(`(async () => {
    const response = await fetch('/api/youdub/examples/assets/jensen-en.mp4', {headers:{Range:'bytes=0-1023'}});
    return {status:response.status, bytes:(await response.arrayBuffer()).byteLength};
  })()`);
  assert.equal(sample.status, 206);
  assert.equal(sample.bytes, 1024);
  if (!workbench && !configured) {
    await page.locator('#setup-language').click();
    await page.getByRole('menuitem', { name: '中文', exact: true }).click();
    await page.getByLabel('安装目录', { exact: true }).fill(join(temporary, 'YouDub media'));
    const submitted = page.waitForResponse(response => {
      const body = response.request().postData();
      return response.url().endsWith('/api/youdub/v2') && body && JSON.parse(body).body?.action === 'configure';
    });
    await page.getByRole('button', { name: '确认并准备环境', exact: true }).click();
    const configuration = await submitted;
    assert.equal(configuration.status(), 200, await configuration.text());
    await page.locator('#setup-directory').waitFor({ state: 'detached' });
    await access(join(youdubHome, 'profiles/desktop/cordis.patch.yml'));
  }
  await page.screenshot({ path: join(evidence, 'first-launch.png') });
  await writeFile(join(evidence, 'result.json'), JSON.stringify({ version: appManifest.version, platform: process.platform,
    arch: process.arch, relocated: !inPlace, restored: configured, installationConfirmed: !workbench,
    isolatedFromHarness: true, setupPhase: setup.phase, demoRange: sample, renderedText: text }, null, 2) + '\n');
  await Promise.race([application.close(), delay(20_000, undefined, { ref: false }).then(() => { throw new Error('Packaged application quit timed out'); })]);
  const [code, signal] = await Promise.race([closed, delay(15_000, undefined, { ref: false }).then(() => { throw new Error('Packaged application did not close cleanly'); })]);
  assert.equal(signal, null);
  assert.equal(code, 0);
  assert.deepEqual(await readdir(harnessHome), ['.credentials.yaml']);
  assert.equal(await readFile(join(harnessHome, '.credentials.yaml'), 'utf8'), sentinel);
  if (process.platform === 'darwin') execFileSync('codesign', ['--verify', '--deep', '--strict', installed], { stdio: 'pipe' });
  complete = true;
  console.log(`Packaged YouDub ${appManifest.version}: relocated ${workbench ? 'workbench and Python worker' : 'first setup'}, local workflow sample and clean exit passed.`);
} finally {
  if (!complete && child.exitCode === null) child.kill('SIGKILL');
  // Preserve diagnostic evidence privately. Local launch tokens are redacted before persistence.
  await writeFile(join(evidence, 'launch.log'), output.replace(/(token[=:]\s*)[^\s&"']+/gi, '$1[redacted]'), { mode: 0o600 });
  if (complete && !stateDirectory) await rm(temporary, { recursive: true });
}
