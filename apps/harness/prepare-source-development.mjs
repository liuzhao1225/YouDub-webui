/** Compose the original Harness development runtime from its complete source build. */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { access, cp, lstat, mkdir, readFile, realpath, symlink, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(here, '../..');
const require = createRequire(import.meta.url);

export async function prepareSourceDevelopment({ projectDirectory = join(here, 'dist/desktop/runtime-project') } = {}) {
  const source = join(root, '.cache/harness/source-build');
  const modules = join(source, 'node_modules/.pnpm/node_modules');
  const primaryRuntime = join(root, '.cache/harness/runtime/primary-runtime');
  const electron = require('electron');
  const pnpm = join(primaryRuntime, 'dependencies/pnpm/bin/pnpm.mjs');
  for (const path of [join(source, '.dsh-build/client-build-environment.json'), join(source, 'apps/cli/lib/bin.js'),
    join(source, 'apps/desktop-host/lib/index.js'), join(source, 'apps/web/dist/index.html'), pnpm]) await access(path);
  const version = JSON.parse(await readFile(join(source, 'package.json'), 'utf8')).version;
  const release = { schemaVersion: 1, version, hostProtocolVersion: 4,
    nodeVersion: execFileSync(electron, ['-p', 'process.versions.node'], { encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } }).trim(),
    pnpmVersion: JSON.parse(await readFile(join(primaryRuntime, 'dependencies/pnpm/package.json'), 'utf8')).version,
  };
  const { prepareDevelopmentProject } = await import(pathToFileURL(join(here, 'dist/desktop/development-project.mjs')));
  const project = prepareDevelopmentProject({ projectDir: projectDirectory,
    cliDir: join(source, 'apps/cli'), hostDir: join(source, 'apps/desktop-host'), dependencyDir: modules,
    release, target: `${process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : process.platform}-${process.arch}`,
  });
  // YouDub's multipart parser is not a Harness dependency. Its original installed
  // dependency remains a third-party package; every Harness package comes from source.
  const busboy = dirname(require.resolve('busboy/package.json'));
  await symlink(busboy, join(project, 'node_modules/busboy'), 'dir');
  const pluginRoot = join(project, 'youdub-plugin');
  await mkdir(join(pluginRoot, 'dist'), { recursive: true });
  for (const name of ['package.json', 'cordis.patch.yml']) await cp(join(here, name), join(pluginRoot, name));
  for (const name of ['host.mjs', 'client.js']) await cp(join(here, 'dist', name), join(pluginRoot, 'dist', name));
  const dependencyLink = join(pluginRoot, 'node_modules');
  try {
    const entry = await lstat(dependencyLink);
    if (!entry.isSymbolicLink()) throw new Error(`Unexpected product dependency directory: ${dependencyLink}`);
    await unlink(dependencyLink);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await symlink(join(project, 'node_modules'), dependencyLink, 'dir');
  const sourcePackages = JSON.parse(await readFile(join(root, 'vendor/deepseek-harness/source-manifest.json'), 'utf8')).packages;
  const resolved = [];
  for (const pkg of sourcePackages) {
    if (!pkg.name.startsWith('@deepseek-ai/')) continue;
    const link = join(project, 'node_modules', pkg.name);
    const actual = await realpath(link);
    const expected = await realpath(join(source, pkg.path));
    if (actual !== expected) throw new Error(`Development runtime does not use preserved source: ${pkg.name} -> ${actual}`);
    resolved.push({ name: pkg.name, source: pkg.path });
  }
  await writeFile(join(project, 'youdub-source-runtime.json'), JSON.stringify({ version, source, pluginRoot,
    sourcePackages: resolved, development: true }, null, 2) + '\n');
  const { resolvePrimaryRuntime } = await import(pathToFileURL(join(project, 'node_modules/@deepseek-ai/dsh-tool-workspace-dependencies/lib/index.js')));
  const { node } = await resolvePrimaryRuntime(primaryRuntime);
  if (!node) throw new Error('The official YouDub runtime payload does not contain Node.js.');
  return { project, pluginRoot, source, modules, primaryRuntime, pnpm, electron, node };
}
