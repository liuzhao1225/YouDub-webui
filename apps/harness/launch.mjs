import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { prepareSourceDevelopment } from './prepare-source-development.mjs';
import { prepareYouDubProfile } from './prepare-profile.mjs';
import { youdubEnvironment } from './product-environment.mjs';
import { desktopNodeEnvironment } from '../../vendor/deepseek-harness/source/apps/desktop/src/node-environment.ts';

// Both development surfaces consume the same source-built framework and app-owned Node runtime.
const here = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(here, '../..');
const home = resolve(process.env.YOUDUB_HOME || join(root, '.cache/harness/dsh'));
const profile = join(home, 'profiles/youdub');
const { project, pluginRoot, pnpm, node, nodeBin } = await prepareSourceDevelopment({ projectDirectory: join(here, 'dist/web-runtime') });
await prepareYouDubProfile(profile, pluginRoot, project, { command: node, args: ['--expose-internals', pnpm], env: desktopNodeEnvironment(node, nodeBin, process.env) });
const args = process.argv.slice(2);
const child = spawn(node, ['--expose-internals', join(project, 'node_modules/@deepseek-ai/dsh-desktop-host/lib/index.js'),
  project, profile, pnpm, nodeBin, '--host', '127.0.0.1', '--port', '3086', '--no-open', ...args], {
  cwd: project, stdio: 'inherit', env: { ...desktopNodeEnvironment(node, undefined, youdubEnvironment(process.env)), DSH_HOME: home, YOUDUB_MEDIA_ROOT: root, YOUDUB_NODE_PATH: node },
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.once('error', error => { console.error(error); process.exitCode = 1; });
child.once('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
