/** Profile-local compatibility permissions readable before any Cordis plugins load. */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'semver'

/** Independent profile metadata; neither package manifests nor Cordis patches carry grants. */
export const PROFILE_COMPATIBILITY_FILENAME = 'compatibility.json'

/** Published and scoped npm package names, as npm accepts them in a manifest dependency key. */
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/

/** Whether a decoded record accepts only exact DSH versions. */
function isVersionList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(version => typeof version === 'string' && isExactPluginVersion(version))
}

/** Test whether an exemption names a canonical exact SemVer, including build metadata.
 * @param value Version supplied by a manifest or user.
 * @returns False for ranges, prefixes, whitespace, and malformed versions.
 */
function isExactPluginVersion(value: string): boolean {
  const parsed = parse(value)
  return parsed !== null && value === `${parsed.version}${parsed.build.length === 0 ? '' : `+${parsed.build.join('.')}`}`
}

/** What one profile's compatibility file currently authorizes, and what is wrong with it. */
export interface ProfileCompatibility {
  /** Accepted exact package-name@version keys mapped to their allowed DSH versions. */
  readonly exemptions: Record<string, string[]>
  /** Human-readable problems; empty when every record was accepted. */
  readonly warnings: string[]
}

/** Read the profile's independent compatibility file without loading plugins.
 * A missing file authorizes nothing. An unreadable or unparsable file authorizes nothing and is
 * reported instead of failing, so a bad file can never make the profile unusable; rejected records
 * are skipped while the remaining valid ones still apply.
 * @param profileDir Absolute profile directory.
 * @returns Accepted exemptions plus every problem found; no manifest fallback is used.
 */
export function readProfileCompatibility(profileDir: string): ProfileCompatibility {
  const filename = join(profileDir, PROFILE_COMPATIBILITY_FILENAME)
  const unreadable = (reason: string): ProfileCompatibility =>
    ({ exemptions: {}, warnings: [`${filename} ${reason}; treating the profile as having no exemptions`] })
  let text: string
  try { text = readFileSync(filename, 'utf8') }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { exemptions: {}, warnings: [] }
    return unreadable(`cannot be read (${String(error)})`)
  }
  let value: unknown
  try { value = JSON.parse(text) }
  catch (error) { return unreadable(`is not valid JSON (${String(error)})`) }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return unreadable('must map exact package@version keys to DSH version lists')
  }
  const exemptions: Record<string, string[]> = {}
  const warnings: string[] = []
  for (const [key, versions] of Object.entries(value as Record<string, unknown>)) {
    const separator = key.lastIndexOf('@')
    if (separator <= 0 || !PACKAGE_NAME.test(key.slice(0, separator)) || !isExactPluginVersion(key.slice(separator + 1))) {
      warnings.push(`${filename}: ${JSON.stringify(key)} is not an exact package-name@version key; the record is ignored`)
      continue
    }
    if (!isVersionList(versions)) {
      warnings.push(`${filename}: ${key} must contain a list of exact DSH versions; the record is ignored`)
      continue
    }
    exemptions[key] = versions
  }
  return { exemptions, warnings }
}

/** Read only the accepted exemptions of a profile.
 * @param profileDir Absolute profile directory.
 * @returns Exact package-name@version keys mapped to their allowed DSH versions.
 */
export function readProfileVersionExemptions(profileDir: string): Record<string, string[]> {
  return readProfileCompatibility(profileDir).exemptions
}
