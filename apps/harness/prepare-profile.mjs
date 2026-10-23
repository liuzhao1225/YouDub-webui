import { lstat, mkdir, readFile, realpath, symlink, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, sep } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { assertYouDubProfile } from './check-profile.mjs';

// Official profile initialization is shared by the CLI launcher and Finder cold starts.
export async function prepareYouDubProfile(profile, pluginRoot, runtimeProject, packageManager) {
  const runtimeRequire = createRequire(join(runtimeProject, 'package.json'));
  const { initProfile, writeProfileBundles } = await import(pathToFileURL(runtimeRequire.resolve('@deepseek-ai/dsh-app-boot')));
  const bundles = ['@youdub/harness-subtitles'];
  const legacyBundles = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', ...bundles];
  initProfile(profile, bundles);
  const manifestPath = join(profile, 'package.json');
  let manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const configuredBundles = manifest.dsh?.profile?.bundles;
  if (!Array.isArray(configuredBundles)) {
    throw new Error(`Unexpected YouDub profile composition: ${manifestPath}`);
  }
  if (legacyBundles.every((name, index) => configuredBundles[index] === name)) {
    // Replace only the known product prefix. Keep installed extensions, their
    // order, dependency metadata and the user's separate patch unchanged.
    manifest = writeProfileBundles(profile, manifest, [...bundles, ...configuredBundles.slice(legacyBundles.length)]);
  } else if (bundles.some((name, index) => configuredBundles[index] !== name)) {
    throw new Error(`Unexpected YouDub profile composition: ${manifestPath}`);
  }
  // pnpm link specifiers use portable paths, including on Windows.
  const dependency = `link:${pluginRoot.split(sep).join('/')}`;
  if (manifest.dependencies?.['@youdub/harness-subtitles'] !== dependency) {
    manifest.dependencies = { ...manifest.dependencies, '@youdub/harness-subtitles': dependency };
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  }
  const { parse } = runtimeRequire('yaml');
  const lockPaths = [join(profile, 'pnpm-lock.yaml'), join(profile, 'node_modules/.pnpm/lock.yaml')];
  const readSdkSpecifier = async path => {
    try { return parse(await readFile(path, 'utf8'))?.importers?.['.']?.dependencies?.['@youdub/harness-subtitles']?.specifier; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  };
  const specifiers = await Promise.all(lockPaths.map(readSdkSpecifier));
  if (specifiers.some(specifier => specifier !== dependency)) {
    if (!packageManager?.command) throw new Error('YouDub profile preparation requires its explicit package manager.');
    const { runPluginCommand } = await import(pathToFileURL(runtimeRequire.resolve('@deepseek-ai/dsh-plugin-manager/operations')));
    // One official install synchronizes wanted and installed dependency metadata.
    const result = await runPluginCommand({ profile: 'youdub', dir: profile, installAnchor: join(runtimeProject, 'package.json'), cwd: runtimeProject },
      ['install', '--no-frozen-lockfile', '--offline', '--ignore-scripts'],
      { ...packageManager, execution: 'service', outputBytes: 32_768, activateNewBundles: false });
    if (result.exitCode !== 0 || result.timedOut) throw new Error(`YouDub profile dependency synchronization failed: ${result.output}\n${result.logPath}`);
    for (const path of lockPaths) {
      if (await readSdkSpecifier(path) !== dependency) throw new Error(`YouDub SDK dependency was not synchronized: ${path}`);
    }
  }
  const layout = join(runtimeProject, 'node_modules/@deepseek-ai/dsh-client-ui-layout');
  for (const [name, target] of [['@youdub/harness-subtitles', pluginRoot], ['@deepseek-ai/dsh-client-ui-layout', layout]]) {
    const link = join(profile, 'node_modules', name);
    await mkdir(dirname(link), { recursive: true });
    try {
      const entry = await lstat(link);
      if (!entry.isSymbolicLink()) throw new Error(`Unexpected installed override: ${link}`);
      if (await realpath(link) !== await realpath(target)) {
        await unlink(link);
        await symlink(await realpath(target), link, 'dir');
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await symlink(await realpath(target), link, 'dir');
    }
  }
  await assertYouDubProfile(profile, join(runtimeProject, 'package.json'));
}
