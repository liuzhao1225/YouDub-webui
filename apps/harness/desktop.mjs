import { access, readFile, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { prepareYouDubProfile } from './prepare-profile.mjs';
import { assertYouDubProfile } from './check-profile.mjs';
import { prepareSourceDevelopment } from './prepare-source-development.mjs';
import { youdubEnvironment } from './product-environment.mjs';
import { desktopNodeEnvironment } from '../../vendor/deepseek-harness/source/apps/desktop/src/node-environment.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(here, '../..');
const output = join(here, 'dist/desktop');
const { values } = parseArgs({ options: {
  python: { type: 'string' }, 'models-dir': { type: 'string' },
  'prepare-only': { type: 'boolean', default: false },
  'skip-setup': { type: 'boolean', default: false },
} });
const home = resolve(process.env.YOUDUB_HOME || join(root, values['skip-setup'] ? '.cache/harness/desktop-ui-test' : '.cache/harness/desktop'));
const userData = home + '-user-data';
const testPython = values['skip-setup'] ? resolve(values.python || process.env.YOUDUB_TEST_PYTHON || join(root, '.venv/bin/python')) : undefined;
if (testPython) await access(testPython, constants.X_OK);
await access(join(output, 'lib/youdub-main.js'));
const { project, pluginRoot, source, pnpm, electron, node, nodeBin } = await prepareSourceDevelopment();
const profile = join(home, 'profiles/desktop');
await prepareYouDubProfile(profile, pluginRoot, project, { command: node, args: ['--expose-internals', pnpm], env: desktopNodeEnvironment(node, nodeBin, process.env) });
if (values.python || values['models-dir']) {
  if (!values.python || !values['models-dir']) throw new Error('Set both --python and --models-dir to configure media execution.');
  await access(values.python);
  await access(values['models-dir']);
  const patchPath = join(profile, 'cordis.patch.yml');
  const original = await readFile(patchPath, 'utf8');
  if (/id:\s*youdub-subtitles\b/.test(original)) throw new Error(`Media configuration already exists; edit ${patchPath}`);
  const patch = (await readFile(join(here, 'desktop.patch.yml'), 'utf8'))
    .replace('__PYTHON__', JSON.stringify(resolve(values.python)))
    .replace('__MODELS__', JSON.stringify(resolve(values['models-dir'])));
  await writeFile(patchPath, original.replace(/^\s*\[\]\s*$/m, '').trimEnd() + '\n' + patch);
}
await assertYouDubProfile(profile, join(project, 'package.json'));
const env = { ...youdubEnvironment(process.env), YOUDUB_HOME: home, DSH_HOME: home, YOUDUB_DESKTOP_RUNTIME_DIR: project,
  YOUDUB_DESKTOP_PNPM_ENTRY: pnpm,
  YOUDUB_HARNESS_PLUGIN_ROOT: pluginRoot, YOUDUB_MEDIA_ROOT: root, YOUDUB_NODE_PATH: node,
  YOUDUB_TEST_SKIP_SETUP: values['skip-setup'] ? '1' : '0',
  ...(testPython ? { YOUDUB_TEST_PYTHON: testPython } : {}),
};
delete env.ELECTRON_RUN_AS_NODE;
if (values['prepare-only']) {
  console.log(`Prepared YouDub Desktop source runtime: ${project}\nYouDub profile: ${profile}\nFramework source workspace: ${source}`);
} else {
  const executable = electron;
  await access(executable);
  console.log(`Starting YouDub from ${executable}\nYouDub profile: ${profile}`);
  if (values['skip-setup']) console.log('UI test mode: environment and model configuration are skipped; media readiness is not verified.');
  const args = [`--user-data-dir=${userData}`, output];
  const child = spawn(executable, args, { cwd: root, env, stdio: 'inherit' });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
  child.once('error', error => { console.error(error); process.exitCode = 1; });
  child.once('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
}
