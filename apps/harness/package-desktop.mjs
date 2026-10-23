/** Package the same product-selected Harness runtime used by development and Host tests. */
import { build, Platform, Arch } from 'electron-builder';
import { cp, mkdir, readFile, writeFile, symlink, access } from 'node:fs/promises';
import { createRequire, isBuiltin } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { prepareSourceDevelopment } from './prepare-source-development.mjs';

const root = resolve(import.meta.dirname, '../..');
const here = import.meta.dirname;
const stage = join(root, '.cache/package/app');
const output = join(root, 'dist');
if (process.argv.includes('--installers-only')) {
  if (process.platform !== 'win32') throw new Error('macOS distribution uses the signed and notarized release step.');
  await build({ projectDir: here, prepackaged: join(output, 'win-unpacked'),
    targets: Platform.WINDOWS.createTarget(['nsis', 'zip'], Arch.x64),
    config: JSON.parse(await readFile(join(root, '.cache/package/builder.json'), 'utf8')) });
} else {
  const { project } = await prepareSourceDevelopment({ projectDirectory: stage });
  const desktop = join(here, 'dist/desktop');
  for (const name of ['main.mjs', 'lib', 'resources', 'scripts']) await cp(join(desktop, name), join(project, name), { recursive: true });
  const manifest = JSON.parse(await readFile(join(project, 'package.json'), 'utf8'));
  Object.assign(manifest, JSON.parse(await readFile(join(desktop, 'package.json'), 'utf8')),
    { description: 'YouDub video localization desktop', author: 'YouDub contributors' });
  const desktopRequire = createRequire(join(desktop, 'package.json'));
  const ownRequire = createRequire(import.meta.url);
  const inputs = JSON.parse(await readFile(join(desktop, 'build-inputs.json'), 'utf8'));
  const productInputs = JSON.parse(await readFile(join(here, 'dist/build-inputs.json'), 'utf8'));
  const extra = new Set(['pnpm', 'yaml']);
  // npm's workspace-link inventory omits these optional platform packages. They
  // are required by Harness internal Node access and subprocess handling.
  const nativePackages = new Set([
    `node-addon-require-builtin-${process.platform}-${process.arch}${process.platform === 'win32' ? '-msvc' : ''}`,
    `@koromix/koffi-${process.platform}-${process.arch}`,
  ]);
  for (const name of nativePackages) extra.add(name);
  const hostDependencies = new Set();
  for (const file of Object.values(productInputs.host.outputs)) for (const item of file.imports) {
    if (item.external && !isBuiltin(item.path)) hostDependencies.add(item.path.startsWith('@') ? item.path.split('/').slice(0, 2).join('/') : item.path.split('/')[0]);
  }
  for (const name of hostDependencies) extra.add(name);
  for (const file of Object.values(inputs.product.outputs)) for (const item of file.imports) {
    if (!item.external || isBuiltin(item.path) || item.path === 'electron') continue;
    extra.add(item.path.startsWith('@') ? item.path.split('/').slice(0, 2).join('/') : item.path.split('/')[0]);
  }
  for (const name of extra) {
    const target = join(project, 'node_modules', name);
    try { await access(target); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const source = name === 'pnpm' ? join(here, 'node_modules/pnpm')
        : nativePackages.has(name) ? join(root, '.cache/harness/source-build/node_modules/.pnpm/node_modules', name)
        : dirname(desktopRequire.resolve(`${name}/package.json`));
      await mkdir(dirname(target), { recursive: true });
      await symlink(source, target, process.platform === 'win32' ? 'junction' : 'dir');
    }
    manifest.dependencies[name] = JSON.parse(await readFile(join(target, 'package.json'), 'utf8')).version;
  }
  const pluginManifestPath = join(project, 'youdub-plugin/package.json');
  const pluginManifest = JSON.parse(await readFile(pluginManifestPath, 'utf8'));
  pluginManifest.dependencies = Object.fromEntries([...hostDependencies].map(name => [name, manifest.dependencies[name]]));
  delete pluginManifest.devDependencies;
  delete pluginManifest.scripts;
  await writeFile(pluginManifestPath, JSON.stringify(pluginManifest, null, 2) + '\n');
  await writeFile(join(project, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
  const metadata = join(root, '.cache/package/build.json');
  await writeFile(metadata, JSON.stringify({ version: manifest.version,
    baseCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    harnessVersion: manifest.harnessRuntimeVersion }, null, 2) + '\n');
  const payload = ['package.json', 'backend/**/*.py', 'backend/requirements*.txt', 'backend/requirements/**/*.txt',
    'packages/builtin/src/**/*', 'packages/sdk/src/**/*', 'submodule/**/*',
    'apps/web/templates/examples.html', 'site/style.css', 'site/player.js', 'site/demos.js', 'site/assets/**/*',
    '!**/__pycache__/**', '!**/.git{,/**}', '!**/node_modules/**', '!**/.env', '!**/env.txt'];
  const platform = process.platform === 'darwin' ? Platform.MAC : process.platform === 'win32' ? Platform.WINDOWS : undefined;
  if (!platform) throw new Error('Desktop installers are supported on macOS and Windows.');
  const arch = process.arch === 'arm64' ? Arch.arm64 : Arch.x64;
  const config = {
      appId: 'com.youdub.desktop', productName: 'YouDub',
      directories: { app: project, output }, electronVersion: ownRequire('electron/package.json').version,
      asar: false, npmRebuild: false,
      files: ['main.mjs', 'lib/**/*', 'resources/**/*', 'scripts/**/*', 'desktop-runtime.json', 'package.json'],
      extraResources: [{ from: root, to: 'youdub', filter: payload }, { from: metadata, to: 'build.json' }],
      mac: { category: 'public.app-category.video', minimumSystemVersion: '14.0', identity: '-',
        icon: join(desktop, 'resources/youdub-icon.png'), artifactName: 'YouDub-${version}-macOS-${arch}.${ext}' },
      win: { icon: join(desktop, 'resources/youdub-icon.png'),
        artifactName: 'YouDub-${version}-windows-${arch}.${ext}' },
      nsis: { oneClick: false, allowToChangeInstallationDirectory: true, artifactName: 'YouDub-${version}-windows-${arch}-Setup.${ext}' },
      publish: null,
    };
  await writeFile(join(root, '.cache/package/builder.json'), JSON.stringify(config, null, 2) + '\n');
  await build({ projectDir: here, targets: platform.createTarget(process.argv.includes('--dir') ? ['dir'] : process.platform === 'darwin' ? ['dmg'] : ['nsis', 'zip'], arch), config });
}
