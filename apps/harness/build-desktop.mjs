import { build } from 'esbuild';
import { access, cp, mkdir, readFile, writeFile, symlink, lstat, readlink, rm, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

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
  plugins: [{ name: 'youdub-sdk', setup(build) {
    build.onResolve({ filter: /^@youdub\/sdk$/ }, () => ({ path: join(root, 'packages/sdk/src/index.ts') }));
  } }],
  outfile: join(output, 'lib/youdub-main.js'),
})).metafile;
await cp(join(compiled, 'apps/desktop/lib/preload-app.cjs'), join(output, 'lib/preload-app.cjs'));
await rm(join(output, 'renderer'), { recursive: true, force: true });
await rm(join(output, 'resources'), { recursive: true, force: true });
await mkdir(join(output, 'resources'), { recursive: true });
await rm(join(output, 'scripts/node-bin'), { recursive: true, force: true });
await cp(join(upstream, 'scripts/node-bin'), join(output, 'scripts/node-bin'), { recursive: true });
const sharp = createRequire(join(root, 'apps/web/package.json'))('sharp');
await sharp(join(root, 'apps/desktop/icon.svg')).png().toFile(join(output, 'resources/youdub-icon.png'));

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
console.log(`YouDub Electron application: ${output}`);
