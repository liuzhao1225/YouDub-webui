import { readFileSync } from 'node:fs'

export function validateReleaseVersion(version, tag) {
  if (typeof version !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    throw new Error('Application version must be a stable major.minor.patch version.')
  }
  if (tag !== undefined && tag !== `v${version}`) throw new Error('Release tag must match package.json version.')
  return version
}

export const appVersion = validateReleaseVersion(JSON.parse(readFileSync(new URL('../package.json', import.meta.url))).version)
