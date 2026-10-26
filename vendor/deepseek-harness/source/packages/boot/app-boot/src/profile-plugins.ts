/** Profile bundle persistence shared with safe-mode sanitization. */

import { writeProfileManifest, type ProfileManifest } from './profile.ts'

/**
 * Write a bundle list while preserving the supplied profile's other metadata.
 * @param profileDir - directory whose package.json is updated.
 * @param manifest - current profile manifest, read after the package operation when applicable.
 * @param bundles - ordered active bundle names, including any template entries.
 * @returns the written manifest.
 */
export function writeProfileBundles(
  profileDir: string, manifest: ProfileManifest, bundles: readonly string[],
): ProfileManifest {
  const updated = { ...manifest, dsh: { ...manifest.dsh, profile: { ...manifest.dsh?.profile, bundles: [...bundles] } } }
  writeProfileManifest(profileDir, updated)
  return updated
}
