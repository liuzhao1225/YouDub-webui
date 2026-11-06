/** Type-only Electron update declarations shared by the settings UI and Desktop compatibility checks. */

/** Public semantic preload fields consumed by the settings row. */
export interface DesktopUpdatePresentation {
  readonly phase: 'idle' | 'checking' | 'available' | 'downloading' | 'verifying' | 'ready' | 'installing' | 'error'
  readonly version?: string
  readonly percent?: number
  readonly failedOperation?: 'check' | 'download' | 'install'
}

/** Optional carrier API; it cannot select artifacts or authorize installation. */
export interface DesktopUpdateBridge {
  status(): Promise<DesktopUpdatePresentation>
  open(): Promise<void>
  subscribe(listener: (state: DesktopUpdatePresentation) => void): () => void
}

/** Shared carrier status for the account row and collapsed sidebar badge. */
export interface DesktopUpdateView {
  readonly presentation?: DesktopUpdatePresentation
  readonly failed: boolean
  readonly opening: boolean
}
