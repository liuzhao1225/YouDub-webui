import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

// A failed YouDub product layer must stop startup instead of opening the
// underlying Harness product. Keep the original parser's diagnostic intact.
export async function assertYouDubProfile(profileDirectory, installAnchor) {
  const runtimeRequire = createRequire(installAnchor);
  const { loadProfileDirectory } = await import(pathToFileURL(runtimeRequire.resolve('@deepseek-ai/dsh-app-boot')));
  const profile = loadProfileDirectory('YouDub', profileDirectory, installAnchor);
  if (profile.skippedBundles.length) {
    throw new Error(profile.skippedBundles.map(item => `${item.packageName}: ${item.reason}`).join('\n'));
  }
  for (const name of ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@youdub/harness-subtitles']) {
    if (!profile.layers.some(layer => layer.packageName === name)) throw new Error(`YouDub profile is missing ${name}: ${profileDirectory}`);
  }
  return profile;
}
