/**
 * Fill the `crypto.randomUUID` gap on insecure origins. Browsers expose
 * `randomUUID` only in secure contexts, and a preview served over plain HTTP
 * on a LAN address is not one — while product code (bundled and VFS-loaded
 * alike) reaches the global directly, Node-style. The worker patches the one
 * `crypto` instance instead of teaching every caller.
 */
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'

/** Install `crypto.randomUUID` when the context withholds it. */
export function installCryptoGlobals(): void {
  // In a secure context the platform method is present and stays untouched.
  if (typeof globalThis.crypto.randomUUID === 'function') return
  Object.defineProperty(globalThis.crypto, 'randomUUID', {
    value: randomUUID,
    configurable: true,
    writable: true,
  })
}
