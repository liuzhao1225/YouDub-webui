import { build } from 'esbuild';
import { access, cp, mkdir, readFile, writeFile, symlink, lstat, readlink, rm, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(here, '../..');
const source = join(root, 'vendor/deepseek-harness/source');
const upstream = join(source, 'apps/desktop');
const compiled = join(root, '.cache/harness/source-build');
const output = join(here, 'dist/desktop');
const modules = join(compiled, 'apps/desktop/node_modules');
await access(join(compiled, '.dsh-build/client-build-environment.json'));
const runtimeVersion = JSON.parse(await readFile(join(source, 'package.json'), 'utf8')).version;
const version = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version;
await rm(join(output, 'lib'), { recursive: true, force: true });
await mkdir(join(output, 'lib'), { recursive: true });

const base = { absWorkingDir: here, bundle: true, platform: 'node', format: 'esm', target: 'node24',
  packages: 'external', nodePaths: [modules], logLevel: 'info', metafile: true };
const records = {};
records.product = (await build({ ...base, entryPoints: [join(here, 'src/desktop-product.ts')],
  outfile: join(output, 'lib/youdub-main.js'),
})).metafile;
for (const entry of ['preload-app']) {
  await cp(join(compiled, 'apps/desktop/lib', entry + '.cjs'), join(output, 'lib', entry + '.cjs'));
}
for (const folder of ['renderer', 'resources', 'scripts/node-bin']) {
  await cp(join(upstream, folder), join(output, folder), { recursive: true });
}

records.developmentProject = (await build({ ...base,
  entryPoints: [join(upstream, 'scripts/development-project.ts')], outfile: join(output, 'development-project.mjs'),
})).metafile;

for (const destination of [join(output, 'node_modules')]) {
  try {
    const entry = await lstat(destination);
    if (!entry.isSymbolicLink()) throw new Error(`Unexpected dependency directory: ${destination}`);
    if (await readlink(destination) !== modules) { await unlink(destination); await symlink(modules, destination, 'dir'); }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await symlink(modules, destination, 'dir');
  }
}
await writeFile(join(output, 'package.json'), JSON.stringify({ name: 'youdub', productName: 'YouDub',
  version, harnessRuntimeVersion: runtimeVersion, private: true, type: 'module', main: 'main.mjs', license: 'Apache-2.0',
}, null, 2) + '\n');
await cp(join(here, 'src/desktop-main.mjs'), join(output, 'main.mjs'));
await writeFile(join(output, 'build-inputs.json'), JSON.stringify(records, null, 2) + '\n');
await writeFile(join(output, 'source-build-inputs.json'), JSON.stringify({ source: compiled,
  preloads: ['preload-app'].map(name => `apps/desktop/lib/${name}.cjs`),
  host: 'apps/desktop-host/lib/index.js', cli: 'apps/cli/lib/bin.js',
  officialBuild: 'scripts/build.ts --scope artifacts' }, null, 2) + '\n');
console.log(`YouDub Electron application: ${output}`);
