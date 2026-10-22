/** Non-default package roles retained outside the experimental group. */

/** Product role that does not require a default runtime mount. */
export type ProductPackageCategory = 'optional' | 'build' | 'test' | 'web-distribution' | 'declarations'

/** One explicitly maintained package role and its reason. */
export interface ProductPackagePolicy {
  /** Why this package remains outside the experimental group. */
  readonly reason: string
  /** The supported product role checked against its directory. */
  readonly category: ProductPackageCategory
}

/**
 * Exceptions to default runtime reachability, keyed by repository-relative package directory.
 * Optional integrations may be reached by an optional bundle without becoming default capabilities.
 */
export const PRODUCT_PACKAGE_POLICY: Readonly<Record<string, ProductPackagePolicy>> = {
  'packages/typert/generator': { category: 'build', reason: 'Build-time generation of type metadata.' },
  'packages/test-support/agent-loop-testkit': { category: 'test', reason: 'Published agent-loop test harness.' },
  'packages/test-support/client-runtime': { category: 'test', reason: 'Published browser plugin test harness.' },
  'packages/test-support/llm-mock-server': { category: 'test', reason: 'Published model-provider test server.' },
  'packages/test-support/loader-smoke': { category: 'test', reason: 'Published plugin Loader smoke-test harness.' },
  'packages/test-support/remote-mock': { category: 'test', reason: 'Published typed Remote test proxies.' },
  'packages/client/web': { category: 'web-distribution', reason: 'Browser boot kernel bundled into the Web distribution.' },
  'packages/client/ui-dockkit': { category: 'web-distribution', reason: 'Layout library bundled into the Web distribution.' },
  'packages/util/package-manifest': { category: 'declarations', reason: 'Shared package metadata declarations have no runtime mount.' },
}
