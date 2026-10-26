/**
 * Outbound HTTP proxy installation and child environment support.
 * The launcher installs an undici global dispatcher before plugins mount, so Node fetch calls
 * and spawned processes receive the configured proxy policy.
 * @module @deepseek-ai/dsh-http-proxy
 */

export { installProxyFromEnvironment, proxyEnvironmentForChild } from './install.ts'
