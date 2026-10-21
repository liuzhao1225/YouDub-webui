import { readFile, writeFile, readlink, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';

// The installed, unchanged Desktop owns Electron, its Host and the reserved profile.
const here = fileURLToPath(new URL('.', import.meta.url));
const { values } = parseArgs({ options: {
  app: { type: 'string', default: '/Applications/DeepSeek Harness.app' },
  initialize: { type: 'boolean' }, setup: { type: 'boolean' },
  python: { type: 'string' }, 'models-dir': { type: 'string' },
} });
const home = resolve(process.env.DSH_HOME || resolve(here, '../../.cache/harness/desktop'));
const userData = home + '-user-data';
const executable = join(values.app, 'Contents/MacOS/DeepSeek Harness');
const cli = join(values.app, 'Contents/Resources/runtime/cli/bin/dsh');
const profile = join(home, 'profiles/desktop');
const manifestPath = join(profile, 'package.json');
const env = { ...process.env, DSH_HOME: home };
delete env.ELECTRON_RUN_AS_NODE;

function run(command, args, options = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd: here, env, stdio: 'inherit', ...options });
    const stop = signal => child.kill(signal);
    const interrupt = () => stop('SIGINT'), terminate = () => stop('SIGTERM');
    process.on('SIGINT', interrupt); process.on('SIGTERM', terminate);
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      process.off('SIGINT', interrupt); process.off('SIGTERM', terminate);
      if (code === 0) resolveRun();
      else reject(new Error(`${command} exited with ${code ?? signal}`));
    });
  });
}

await access(executable);
// Inspect the signed application's own manifest through its Electron Node runtime.
await run(executable, ['-e', `const fs=require('fs');const p=JSON.parse(fs.readFileSync(${JSON.stringify(join(values.app, 'Contents/Resources/app.asar/package.json'))},'utf8'));if(p.version!=='0.2.1-rc.2')throw new Error('Expected Harness Desktop 0.2.1-rc.2, got '+p.version);console.log('Harness Desktop '+p.version);`], {
  env: { ...env, ELECTRON_RUN_AS_NODE: '1' },
});

if (values.setup) {
  // Package changes follow the official installed CLI, with Desktop fully quit.
  try {
    const lock = await readlink(join(userData, 'SingletonLock'));
    const pid = Number(lock.slice(lock.lastIndexOf('-') + 1));
    if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error(`Invalid Desktop process lock: ${lock}`);
    let running = true;
    try { process.kill(pid, 0); }
    catch (error) { if (error.code !== 'ESRCH') throw error; running = false; }
    if (running) throw new Error(`Quit this Desktop instance before setup (PID ${pid}).`);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await access(manifestPath).catch(error => { throw new Error('Initialize the official Desktop profile with npm run desktop -- --initialize, then quit it before setup.', { cause: error }); });
  if (!values.python || !values['models-dir']) throw new Error('--python and --models-dir are required for setup.');
  await access(values.python); await access(join(values['models-dir'], 'tiny.pt'));
  const patchPath = join(profile, 'cordis.patch.yml');
  const existingPatch = await readFile(patchPath, 'utf8');
  if (/id:\s*youdub-subtitles\b/.test(existingPatch)) {
    throw new Error(`YouDub is already configured. Edit it in place: ${patchPath}`);
  }
  await run(cli, ['plugin', '--profile', 'desktop', 'add', `link:${here}`, '--registry=https://registry.npmmirror.com']);
  const patch = (await readFile(join(here, 'desktop.patch.yml'), 'utf8'))
    .replace('__PYTHON__', JSON.stringify(resolve(values.python)))
    .replace('__MODELS__', JSON.stringify(resolve(values['models-dir'])));
  await writeFile(patchPath, existingPatch.trimEnd() + '\n\n' + patch);
  console.log(`Configured ${patchPath}\nRun npm run desktop to open YouDub.`);
} else {
  if (!values.initialize) await access(manifestPath);
  console.log(`Harness home: ${home}\nElectron user data: ${userData}`);
  await run(executable, [`--user-data-dir=${userData}`]);
}
