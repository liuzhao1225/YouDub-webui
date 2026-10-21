import { access, cp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { prepareYouDubProfile } from './prepare-profile.mjs';
import { assertYouDubProfile } from './check-profile.mjs';
import { prepareSourceDevelopment } from './prepare-source-development.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(here, '../..');
const output = join(here, 'dist/desktop');
const { values } = parseArgs({ options: {
  python: { type: 'string' }, 'models-dir': { type: 'string' },
  'runtime-source': { type: 'string' }, 'prepare-only': { type: 'boolean', default: false },
} });
const home = resolve(process.env.DSH_HOME || join(root, '.cache/harness/desktop'));
const userData = home + '-user-data';
const runtime = join(root, '.cache/harness/runtime');
const primaryRuntime = join(runtime, 'primary-runtime');
await access(join(output, 'lib/youdub-main.js'));
if (values['runtime-source']) {
  const source = resolve(values['runtime-source']);
  for (const name of ['primary-runtime', 'office-skills']) {
    await access(join(source, name));
    await cp(join(source, name), join(runtime, name), { recursive: true, errorOnExist: true, force: false });
  }
}
await access(primaryRuntime).catch(error => {
  throw new Error('Missing official runtime payload. Run with --runtime-source <directory containing primary-runtime and office-skills>.', { cause: error });
});
const { project, pluginRoot, source, pnpm, electron, node } = await prepareSourceDevelopment();
const profile = join(home, 'profiles/desktop');
await prepareYouDubProfile(profile, pluginRoot, project, { command: process.execPath, args: [pnpm] });
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
const env = { ...process.env, DSH_HOME: home, DSH_DESKTOP_DSH_DIR: project,
  DSH_DESKTOP_PRIMARY_RUNTIME_DIR: primaryRuntime, DSH_DESKTOP_PNPM_ENTRY: pnpm,
  YOUDUB_HARNESS_PLUGIN_ROOT: pluginRoot, YOUDUB_MEDIA_ROOT: root, YOUDUB_NODE_PATH: node,
};
delete env.ELECTRON_RUN_AS_NODE;
if (values['prepare-only']) {
  console.log(`Prepared YouDub Desktop source runtime: ${project}\nHarness profile: ${profile}\nOfficial source workspace: ${source}`);
} else {
  const executable = electron;
  await access(executable);
  console.log(`Starting YouDub from ${executable}\nHarness profile: ${profile}`);
  const args = [`--user-data-dir=${userData}`, output];
  const child = spawn(executable, args, { cwd: root, env, stdio: 'inherit' });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
  child.once('error', error => { console.error(error); process.exitCode = 1; });
  child.once('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
}
