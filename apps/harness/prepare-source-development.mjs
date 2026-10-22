/** Compose the product-selected Harness development runtime from its reviewed source build. */
import { execFileSync } from 'node:child_process';
import { createRequire, isBuiltin } from 'node:module';
import { access, cp, lstat, mkdir, readFile, realpath, symlink, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFrameworkSource } from './baselines/framework-source.mjs';
import { desktopNodeEnvironment } from '../../vendor/deepseek-harness/source/apps/desktop/src/node-environment.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(here, '../..');
const require = createRequire(import.meta.url);

export async function prepareSourceDevelopment({ projectDirectory = join(here, 'dist/desktop/runtime-project') } = {}) {
  const source = join(root, '.cache/harness/source-build');
  const framework = await readFrameworkSource(root);
  const receipt = JSON.parse(await readFile(join(source, 'youdub-source-build.json'), 'utf8'));
  if (receipt.sourceTreeSha256 !== framework.sha256) throw new Error('Framework source has changed since its build; run npm run build:framework.');
  const modules = join(source, 'node_modules/.pnpm/node_modules');
  const electron = require('electron');
  const pnpm = join(here, 'node_modules/pnpm/bin/pnpm.mjs');
  const nodeBin = join(here, 'dist/desktop/scripts/node-bin');
  for (const path of [join(source, '.dsh-build/client-build-environment.json'), join(source, 'apps/cli/lib/profile-boot.js'),
    join(source, 'apps/desktop-host/lib/index.js'), join(source, 'apps/web/dist/index.html'), pnpm]) await access(path);
  const version = JSON.parse(await readFile(join(source, 'package.json'), 'utf8')).version;
  const release = { schemaVersion: 1, version, hostProtocolVersion: 4,
    nodeVersion: execFileSync(electron, ['-p', 'process.versions.node'], { encoding: 'utf8', env: desktopNodeEnvironment(electron, undefined, process.env) }).trim(),
    pnpmVersion: JSON.parse(await readFile(join(here, 'node_modules/pnpm/package.json'), 'utf8')).version,
  };
  const { prepareDevelopmentProject } = await import(pathToFileURL(join(here, 'dist/desktop/development-project.mjs')));
  const sourceRequire = createRequire(join(source, 'apps/cli/package.json'));
  const { loadOverlayPatches } = await import(pathToFileURL(sourceRequire.resolve('@deepseek-ai/dsh-app-boot')));
  const patches = loadOverlayPatches('YouDub', join(here, 'cordis.patch.yml'));
  const selected = new Set(['@deepseek-ai/dsh-web-frontend']);
  for (const patch of patches) {
    if (!Array.isArray(patch.insert)) throw new Error('YouDub product composition must declare inserted entries.');
    for (const entry of patch.insert) {
      if (entry.name === '@youdub/harness-subtitles') continue;
      if (typeof entry.name !== 'string' || !entry.name.startsWith('@deepseek-ai/')) throw new Error('Unexpected product framework entry.');
      selected.add(entry.name.split('/').slice(0, 2).join('/'));
    }
  }
  // Bundled business code retains these external imports. Read the actual build
  // record so a new external cannot silently resolve from another installation.
  const buildInputs = JSON.parse(await readFile(join(here, 'dist/build-inputs.json'), 'utf8'));
  const externals = new Set();
  for (const output of Object.values(buildInputs.host.outputs)) {
    for (const item of output.imports) {
      if (!item.external || isBuiltin(item.path)) continue;
      const name = item.path.startsWith('@') ? item.path.split('/').slice(0, 2).join('/') : item.path.split('/')[0];
      if (name.startsWith('@deepseek-ai/')) selected.add(name);
      else externals.add(name);
    }
  }
  const project = prepareDevelopmentProject({ projectDir: projectDirectory,
    cliDir: join(source, 'apps/cli'), hostDir: join(source, 'apps/desktop-host'), dependencyDir: modules,
    packages: [...selected].sort(),
    release, target: `${process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : process.platform}-${process.arch}`,
  });
  // Business externals resolve from YouDub's own dependencies. Framework packages
  // remain source-built; no unrelated hoisted package enters the project.
  for (const name of externals) await symlink(dirname(require.resolve(`${name}/package.json`)), join(project, 'node_modules', name), 'dir');
  // Profile lockfile inspection uses the same YAML parser as PluginManager.
  const managerRequire = createRequire(join(source, 'packages/boot/plugin-manager/package.json'));
  await symlink(dirname(managerRequire.resolve('yaml/package.json')), join(project, 'node_modules/yaml'), 'dir');
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
  const runtime = JSON.parse(await readFile(join(project, 'desktop-runtime.json'), 'utf8'));
  const sourcePackages = runtime.sharedPackages.map(({ name }) => {
    const pkg = framework.packages.find(pkg => pkg.name === name);
    if (!pkg) throw new Error(`Runtime package has no reviewed source: ${name}`);
    return pkg;
  });
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
    roots: [...selected].sort(), sourcePackages: resolved, development: true }, null, 2) + '\n');
  return { project, pluginRoot, source, modules, pnpm, electron, node: electron, nodeBin };
}
