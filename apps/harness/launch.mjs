import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { prepareSourceDevelopment } from './prepare-source-development.mjs';
import { prepareYouDubProfile } from './prepare-profile.mjs';

// Both development surfaces consume the same unchanged, source-built Harness packages.
const here = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(here, '../..');
const home = resolve(process.env.DSH_HOME || join(root, '.cache/harness/dsh'));
const profile = join(home, 'profiles/youdub');
const { project, pluginRoot, pnpm, node } = await prepareSourceDevelopment({ projectDirectory: join(here, 'dist/web-runtime') });
await prepareYouDubProfile(profile, pluginRoot, project, { command: process.execPath, args: [pnpm] });
const args = process.argv.slice(2);
const diagnostic = args.some(arg => ['--dump-config', '--dump-config-schema', '--dump-default-config'].includes(arg));
const child = spawn(process.execPath, [join(project, 'node_modules/@deepseek-ai/dsh/lib/bin.js'), '--profile', 'youdub', ...(diagnostic ? args : ['--host', '127.0.0.1', '--port', '3086', '--no-open', ...args])], {
  cwd: project, stdio: 'inherit', env: { ...process.env, DSH_HOME: home, YOUDUB_MEDIA_ROOT: root, YOUDUB_NODE_PATH: node },
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.once('error', error => { console.error(error); process.exitCode = 1; });
child.once('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
