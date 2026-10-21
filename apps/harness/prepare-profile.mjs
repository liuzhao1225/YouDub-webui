import { lstat, mkdir, readFile, realpath, symlink, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { assertYouDubProfile } from './check-profile.mjs';

// Official profile initialization is shared by the CLI launcher and Finder cold starts.
export async function prepareYouDubProfile(profile, pluginRoot, runtimeProject, packageManager) {
  const runtimeRequire = createRequire(join(runtimeProject, 'package.json'));
  const { initProfile } = await import(pathToFileURL(runtimeRequire.resolve('@deepseek-ai/dsh-app-boot')));
  const bundles = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@youdub/harness-subtitles'];
  initProfile(profile, bundles);
  const manifestPath = join(profile, 'package.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const configuredBundles = manifest.dsh?.profile?.bundles;
  if (!Array.isArray(configuredBundles) || bundles.some((name, index) => configuredBundles[index] !== name)) {
    throw new Error(`Unexpected YouDub profile composition: ${manifestPath}`);
  }
  const dependency = `link:${pluginRoot}`;
  if (manifest.dependencies?.['@youdub/harness-subtitles'] !== dependency) {
    manifest.dependencies = { ...manifest.dependencies, '@youdub/harness-subtitles': dependency };
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  }
  const { parse } = runtimeRequire('yaml');
  let lock;
  try { lock = parse(await readFile(join(profile, 'pnpm-lock.yaml'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (lock?.importers?.['.']?.dependencies?.['@youdub/harness-subtitles']?.specifier !== dependency) {
    if (!packageManager?.command) throw new Error('YouDub profile preparation requires its explicit package manager.');
    const { runPluginCommand } = await import(pathToFileURL(runtimeRequire.resolve('@deepseek-ai/dsh-plugin-manager/operations')));
    // pnpm remove can otherwise restore an untouched dependency from its stale
    // lock entry even after package.json and node_modules point to the new SDK.
    const result = await runPluginCommand({ profile: 'youdub', dir: profile, installAnchor: join(runtimeProject, 'package.json'), cwd: runtimeProject },
      ['install', '--lockfile-only', '--offline', '--ignore-scripts'], { ...packageManager, execution: 'service', outputBytes: 32_768, activateNewBundles: false });
    if (result.exitCode !== 0 || result.timedOut) throw new Error(`YouDub profile dependency synchronization failed: ${result.output}\n${result.logPath}`);
    const saved = parse(await readFile(join(profile, 'pnpm-lock.yaml'), 'utf8'));
    if (saved?.importers?.['.']?.dependencies?.['@youdub/harness-subtitles']?.specifier !== dependency) throw new Error(`YouDub SDK dependency was not synchronized: ${manifestPath}`);
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
