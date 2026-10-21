/** Minimal page-target CDP methods required to expose Network, Console, and Sources together. */

import type { CdpRequest } from './protocol.ts'

/** Sentinel distinguishing an unowned method from an owned method returning undefined. */
export const CDP_METHOD_NOT_HANDLED = Symbol('CDP_METHOD_NOT_HANDLED')

/** Page-target identity used by discovery and scaffold responses. */
export interface CdpTargetDescriptor {
  readonly targetId: string
  readonly title: string
}

/**
 * Handle one Worker-local identity or page scaffold method.
 * @param request - Parsed CDP request.
 * @param target - Synthetic page-target identity.
 * @returns A response result or the unowned-method sentinel.
 */
export function handleScaffold(
  request: CdpRequest,
  target: CdpTargetDescriptor,
): object | typeof CDP_METHOD_NOT_HANDLED {
  const frame = {
    id: 'dsh-inspector-host-frame',
    loaderId: 'dsh-inspector-loader',
    url: 'dsh://host',
    domainAndRegistry: '',
    securityOrigin: 'dsh://host',
    mimeType: 'text/html',
    secureContextType: 'Secure',
    crossOriginIsolatedContextType: 'NotIsolated',
    gatedAPIFeatures: [],
  }
  switch (request.method) {
    case 'Page.enable':
    case 'Page.disable':
    case 'Page.setLifecycleEventsEnabled':
    case 'Target.setDiscoverTargets':
    case 'Target.setAutoAttach':
    case 'Log.enable':
    case 'Log.disable':
    case 'Console.enable':
    case 'Console.disable':
      return {}
    case 'Page.getFrameTree':
      return { frameTree: { frame, childFrames: [] } }
    case 'Page.getResourceTree':
      return { frameTree: { frame, resources: [] } }
    case 'Page.getNavigationHistory':
      return {
        currentIndex: 0,
        entries: [{ id: 1, url: frame.url, userTypedURL: frame.url, title: target.title, transitionType: 'typed' }],
      }
    case 'Target.getTargetInfo':
      return {
        targetInfo: {
          targetId: target.targetId,
          type: 'page',
          title: target.title,
          url: frame.url,
          attached: true,
          canAccessOpener: false,
        },
      }
    case 'Browser.getVersion':
      return {
        protocolVersion: '1.3',
        product: 'dsh-experimental-inspector/0',
        revision: '@experimental',
        userAgent: 'dsh-experimental-inspector',
        jsVersion: process.versions.v8,
      }
    default:
      return CDP_METHOD_NOT_HANDLED
  }
}
