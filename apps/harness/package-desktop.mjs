/** Package the same product-selected Harness runtime used by development and Host tests. */
import { build, Platform, Arch } from 'electron-builder';
import { cp, mkdir, readFile, writeFile, symlink, access } from 'node:fs/promises';
import { createRequire, isBuiltin } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { prepareSourceDevelopment } from './prepare-source-development.mjs';
import { desktopFiles, productResources } from './package-files.mjs';

const root = resolve(import.meta.dirname, '../..');
const here = import.meta.dirname;
const stage = join(root, '.cache/package/app');
const output = join(root, 'dist');
if (process.argv.includes('--installers-only')) {
  if (process.platform !== 'win32') throw new Error('macOS distribution uses the signed and notarized release step.');
  await build({ projectDir: here, prepackaged: join(output, 'win-unpacked'),
    targets: Platform.WINDOWS.createTarget(['zip'], Arch.x64),
    config: JSON.parse(await readFile(join(root, '.cache/package/builder.json'), 'utf8')) });
  // Preserve the existing Inno Setup AppId, upgrade path and uninstall registration.
  const sharp = createRequire(join(root, 'apps/web/package.json'))('sharp');
  const sizes = [16, 32, 48, 64, 128, 256];
  const images = await Promise.all(sizes.map(size => sharp(join(root, 'apps/desktop/icon.svg')).resize(size, size).png().toBuffer()));
  const header = Buffer.alloc(6 + images.length * 16);
  header.writeUInt16LE(1, 2); header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  for (const [index, png] of images.entries()) {
    const at = 6 + index * 16, size = sizes[index];
    header[at] = header[at + 1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1, at + 4); header.writeUInt16LE(32, at + 6);
    header.writeUInt32LE(png.length, at + 8); header.writeUInt32LE(offset, at + 12);
    offset += png.length;
  }
  await mkdir(join(root, '.cache/windows'), { recursive: true });
  await writeFile(join(root, '.cache/windows/YouDub.ico'), Buffer.concat([header, ...images]));
  const version = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version;
  const compiler = process.env.YOUDUB_ISCC || join(process.env['ProgramFiles(x86)'] || 'C:/Program Files (x86)', 'Inno Setup 6/ISCC.exe');
  await access(compiler);
  execFileSync(compiler, [`/DAppVersion=${version}`, `/DRepoRoot=${root}`, join(root, 'apps/desktop/windows/installer.iss')], { stdio: 'inherit' });
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

  const platform = process.platform === 'darwin' ? Platform.MAC : process.platform === 'win32' ? Platform.WINDOWS : undefined;
  if (!platform) throw new Error('Desktop installers are supported on macOS and Windows.');
  const arch = process.arch === 'arm64' ? Arch.arm64 : Arch.x64;
  const config = {
      appId: 'com.youdub.desktop', productName: 'YouDub',
      directories: { app: project, output }, electronVersion: ownRequire('electron/package.json').version,
      asar: false, npmRebuild: false,
      files: desktopFiles,
      extraResources: [{ from: root, to: 'youdub', filter: productResources }, { from: metadata, to: 'build.json' },
        { from: join(root, 'LICENSE'), to: 'LICENSE-YouDub.txt' },
        { from: join(root, 'vendor/deepseek-harness/source/LICENSE'), to: 'LICENSE-Harness.txt' },
        { from: join(root, 'vendor/deepseek-harness/source/THIRD_PARTY_NOTICES.md'), to: 'THIRD_PARTY_NOTICES-Harness.md' }],
      mac: { category: 'public.app-category.video', minimumSystemVersion: '14.0', identity: '-',
        icon: join(desktop, 'resources/youdub-icon.png'), artifactName: 'YouDub-${version}-macOS-${arch}.${ext}' },
      win: { icon: join(desktop, 'resources/youdub-icon.png'),
        artifactName: 'YouDub-${version}-windows-${arch}.${ext}' },
      publish: null,
    };
  await writeFile(join(root, '.cache/package/builder.json'), JSON.stringify(config, null, 2) + '\n');
  await build({ projectDir: here, targets: platform.createTarget(['dir'], arch), config });
}
