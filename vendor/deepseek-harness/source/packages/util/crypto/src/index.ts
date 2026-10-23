/**
 * UUID minting that works in every JavaScript context this repository ships
 * to. `crypto.randomUUID` is a secure-context Web API — a page or worker
 * served over plain HTTP on a LAN address has no such method — while
 * `crypto.getRandomValues` is unrestricted everywhere (browsers, workers,
 * Node ≥ 19). One implementation here replaces per-caller polyfills; the
 * `no-restricted-properties` lint rule points `crypto.randomUUID` callers at
 * this module.
 * @module @deepseek-ai/dsh-util-crypto
 */

/** RFC 9562 UUID string, the shape `crypto.randomUUID` declares. */
export type Uuid = `${string}-${string}-${string}-${string}-${string}`

/**
 * Encode bytes as canonical base64 without overflowing function argument limits.
 * @param data - Bytes to encode.
 * @returns base64 text.
 */
export function bytesToBase64(data: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let offset = 0; offset < data.length; offset += chunk) {
    binary += String.fromCharCode(...data.subarray(offset, offset + chunk))
  }
  return btoa(binary)
}

/**
 * Random v4 UUID, minted from `crypto.getRandomValues`.
 * @returns the UUID string.
 */
export function randomUUID(): Uuid {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16))
  // RFC 9562 §5.4: version 4 in the high nibble of byte 6, variant 10 in byte 8.
  const hex = Array.from(bytes, (byte, index) => {
    const pinned = index === 6 ? (byte & 0x0f) | 0x40 : index === 8 ? (byte & 0x3f) | 0x80 : byte
    return pinned.toString(16).padStart(2, '0')
  }).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
