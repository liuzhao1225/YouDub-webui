/** Experimental package identities, publication policy, and retained npm names. */

/** Existing npm names retained by capabilities now housed under experimental/. */
export const EXPERIMENTAL_PACKAGE_NAME_EXCEPTIONS: Readonly<Record<string, string>> = {
  'packages/experimental/tool-session-query': '@deepseek-ai/dsh-tool-session-query',
  'packages/experimental/tool-terminal': '@deepseek-ai/dsh-tool-terminal',
} satisfies Record<`packages/experimental/${string}`, `@deepseek-ai/dsh-${string}`>

/** npm namespace for experimental packages without retained-name exceptions. */
export const EXPERIMENTAL_PACKAGE_NAME_PREFIX = '@deepseek-ai/dsh-experimental-'
const retainedNames = new Set(Object.values(EXPERIMENTAL_PACKAGE_NAME_EXCEPTIONS))

/**
 * Identify an experimental npm package independently of its installed directory.
 * @param name - complete npm package name, without a version or subpath.
 * @returns Whether the name uses the experimental prefix or a retained name.
 */
export function isExperimentalPackageName(name: string): boolean {
  return name.startsWith(EXPERIMENTAL_PACKAGE_NAME_PREFIX) || retainedNames.has(name)
}

/**
 * Find experimental identities in module ids, paths, subpaths, or npm alias specifications.
 * @param reference - package reference or bundler/runtime module identifier.
 * @returns Whether a delimited package name identifies an experimental capability.
 */
export function hasExperimentalPackageReference(reference: string): boolean {
  const normalized = reference.replaceAll('\\', '/')
  return [...normalized.matchAll(/(?:^|[/:\u0000])(@deepseek-ai\/[^/@?#:\s]+)(?=$|[/@?#:])/g)]
    .some(([, name]) => name !== undefined && isExperimentalPackageName(name))
}
