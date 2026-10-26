/** Filesystem ownership for the Electron-managed desktop installation. */

import { join } from 'node:path'

/** Stable desktop installation paths under the application's own home. */
export interface DesktopPaths {
  readonly profile: string
}

/**
 * Resolve every Electron-owned path from the product entry's explicit data root.
 * @param home - YouDub-owned home selected by its launcher.
 * @returns immutable desktop path set.
 */
export function resolveDesktopPaths(home: string): DesktopPaths {
  return {
    profile: join(home, 'profiles', 'desktop'),
  }
}
