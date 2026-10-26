/** Origin-scoped boot, native directory selection and native shortcuts. */

import type { DesktopShortcutInput, ShortcutConfigSnapshot, ShortcutSaveResult } from '@deepseek-ai/dsh-client-shortcuts/protocol'
import { contextBridge, ipcRenderer } from 'electron'
import { DESKTOP_IPC, SCHEME, type DshDesktopProductApi } from './ipc.ts'
import { markDocumentPlatform, syncWindowFullscreen } from './preload-platform.ts'
import { syncNativeTheme } from './preload-theme.ts'
import { syncWindowsAppearance } from './preload-windows.ts'

function createProductApi(): DshDesktopProductApi {
  return {
    protocolVersion: 1,
    updates: {
      status: () => ipcRenderer.invoke(DESKTOP_IPC.updatesStatus),
      open: () => ipcRenderer.invoke(DESKTOP_IPC.updatesOpen),
      subscribe(listener) {
        const handle = (_event: Electron.IpcRendererEvent, state: import('./ipc.ts').DesktopUpdateState): void => { listener(state) }
        ipcRenderer.on(DESKTOP_IPC.updatesChanged, handle)
        return () => { ipcRenderer.off(DESKTOP_IPC.updatesChanged, handle) }
      },
    },
    keyboard: {
      closeWindow: revision => ipcRenderer.invoke(DESKTOP_IPC.shortcutsCloseWindow, revision) as Promise<void>,
      subscribe: (listener) => {
        const handle = (_event: Electron.IpcRendererEvent, input: DesktopShortcutInput): void => {
          if (input.kind === 'iframe') {
            const element = document.activeElement
            if (!(element instanceof HTMLIFrameElement) || !element.isConnected
              || !element.matches('iframe[data-sidebar-browser-frame], iframe[data-html-preview]')) return
            if (input.frameName === '' || element.name !== input.frameName) return
          }
          listener(input)
        }
        ipcRenderer.on(DESKTOP_IPC.shortcutsInput, handle)
        return () => { ipcRenderer.off(DESKTOP_IPC.shortcutsInput, handle) }
      },
    },
    shortcuts: {
      get: definitions => ipcRenderer.invoke(DESKTOP_IPC.shortcutsGet, definitions) as Promise<ShortcutConfigSnapshot>,
      edit: (edit, revision) => ipcRenderer.invoke(DESKTOP_IPC.shortcutsEdit, edit, revision) as Promise<ShortcutSaveResult>,
      recording: active => ipcRenderer.invoke(DESKTOP_IPC.shortcutsRecording, active) as Promise<void>,
      subscribe(listener) {
        const handle = (_event: Electron.IpcRendererEvent, snapshot: ShortcutConfigSnapshot): void => { listener(snapshot) }
        ipcRenderer.on(DESKTOP_IPC.shortcutsChanged, handle)
        return () => { ipcRenderer.off(DESKTOP_IPC.shortcutsChanged, handle) }
      },
    },
  }
}

if (location.protocol === `${SCHEME}:` && location.hostname === 'app') {
  syncWindowsAppearance()
  contextBridge.exposeInMainWorld('__DSH_DIRECTORY_PICKER__', {
    pick: () => ipcRenderer.invoke(DESKTOP_IPC.directoryPick) as Promise<string | null>,
  })
  contextBridge.exposeInMainWorld('dshDesktopBoot', {
    ready: () => ipcRenderer.invoke(DESKTOP_IPC.boot) as Promise<unknown>,
    failed: (message: string) => ipcRenderer.invoke(DESKTOP_IPC.bootFailed, message) as Promise<void>,
  })

}

markDocumentPlatform()
syncWindowFullscreen()
syncNativeTheme()
// Main-process IPC also verifies the owning window and top frame.
contextBridge.exposeInMainWorld('dshDesktop', location.protocol === `${SCHEME}:` && location.hostname === 'app' && process.isMainFrame ? createProductApi() : { protocolVersion: 1 })

if (location.protocol === `${SCHEME}:` && location.hostname === 'app') {
  contextBridge.exposeInMainWorld('__DSH_LOCALE__', {
    read: () => ipcRenderer.invoke(DESKTOP_IPC.localeBootstrap),
    onChange: (locale: string) => { ipcRenderer.send(DESKTOP_IPC.localeChanged, locale) },
  })
}
