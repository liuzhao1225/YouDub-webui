/** Typed preload operations exposed only by the Electron shell. */

import type { DesktopKeyboardApi, DesktopShortcutsApi } from '@deepseek-ai/dsh-client-shortcuts/protocol'
import type { IpcMainInvokeEvent } from 'electron'

/** IPC channel names kept private to the desktop application bundle. */
export const DESKTOP_IPC = {
  updatesStatus: 'youdub-desktop:updates-status',
  updatesOpen: 'youdub-desktop:updates-open',
  updatesChanged: 'youdub-desktop:updates-changed',
  shortcutsInput: 'youdub-desktop:shortcuts-input',
  shortcutsCloseWindow: 'youdub-desktop:shortcuts-close-window',
  shortcutsGet: 'youdub-desktop:shortcuts-get',
  shortcutsEdit: 'youdub-desktop:shortcuts-edit',
  shortcutsChanged: 'youdub-desktop:shortcuts-changed',
  shortcutsRecording: 'youdub-desktop:shortcuts-recording',
  boot: 'youdub-desktop:boot',
  bootFailed: 'youdub-desktop:boot-failed',
  directoryPick: 'youdub-desktop:directory-pick',
  localeBootstrap: 'youdub-desktop:locale-bootstrap',
  localeChanged: 'youdub-desktop:locale-changed',
  nativeThemeSet: 'youdub-desktop:native-theme-set',
  windowFullscreen: 'youdub-desktop:window-fullscreen',
  windowsAppearance: 'youdub-desktop:windows-appearance',
  windowsMenu: 'youdub-desktop:windows-menu',
} as const

/** Check-only presentation, compatible with Harness's settings/update indicators. */
export interface DesktopUpdateState {
  phase: 'idle' | 'checking' | 'available' | 'error'
  version?: string
  failure?: 'check'
  failedOperation?: 'check'
  message?: string
}

/** Operations exposed by the YouDub desktop shell. */
export interface YouDubDesktopProductApi {
  readonly protocolVersion: 1
  readonly updates: {
    status(): Promise<DesktopUpdateState>
    open(): Promise<void>
    subscribe(listener: (state: DesktopUpdateState) => void): () => void
  }
  readonly keyboard: DesktopKeyboardApi
  readonly shortcuts: DesktopShortcutsApi
}

/** Scheme of Desktop-owned application documents. */
export const SCHEME = 'youdub-app'

/**
 * Reject IPC outside the allowed Desktop document origins.
 * @param event - IPC caller whose frame URL supplies the origin.
 * @param hostnames - Desktop document hosts allowed for this operation.
 */
export function assertDesktopSender(event: IpcMainInvokeEvent, hostnames: readonly string[]): void {
  const senderFrame = event.senderFrame
  if (senderFrame === null) throw new Error('YouDub desktop: rejected IPC without a sender frame')
  const url = new URL(senderFrame.url)
  if (url.protocol !== `${SCHEME}:` || !hostnames.includes(url.hostname)) {
    throw new Error('YouDub desktop: rejected IPC from an unowned renderer')
  }
}
