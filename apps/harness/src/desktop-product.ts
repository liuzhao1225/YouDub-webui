/** YouDub product assembly using the reviewed Harness framework fork. */
import { prepareYouDubProfile } from '../prepare-profile.mjs'
import { assertYouDubProfile } from '../check-profile.mjs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, Menu, powerMonitor, nativeTheme, net, protocol, session, shell,
  type IpcMainInvokeEvent, type MenuItemConstructorOptions } from 'electron'
import { resolveDesktopPaths } from '../../../vendor/deepseek-harness/source/apps/desktop/src/paths.ts'
import { DesktopProjectManager } from '../../../vendor/deepseek-harness/source/apps/desktop/src/project-manager.ts'
import { DesktopHostFatalError, DesktopHostProcess } from '../../../vendor/deepseek-harness/source/apps/desktop/src/host-process.ts'
import { installDesktopDirectoryPicker } from '../../../vendor/deepseek-harness/source/apps/desktop/src/directory-picker.ts'
import { installMicrophonePermissions } from '../../../vendor/deepseek-harness/source/apps/desktop/src/microphone-permissions.ts'
import { DesktopBackendController } from '../../../vendor/deepseek-harness/source/apps/desktop/src/backend-controller.ts'
import { DESKTOP_IPC, SCHEME, assertDesktopSender } from '../../../vendor/deepseek-harness/source/apps/desktop/src/ipc.ts'
import { readDeviceInfo } from '../../../vendor/deepseek-harness/source/apps/desktop/src/device-info.ts'
import { resolveDesktopLocale, resolveDesktopStartupLocale } from '../../../vendor/deepseek-harness/source/apps/desktop/src/locale.ts'
import { claimDesktopSingleInstance } from '../../../vendor/deepseek-harness/source/apps/desktop/src/single-instance.ts'
import { serveWebDocument, authenticateWebHost, forwardWebRequest } from '../../../vendor/deepseek-harness/source/apps/desktop/src/web-document.ts'
import { DesktopFatalRecovery } from '../../../vendor/deepseek-harness/source/apps/desktop/src/fatal-recovery.ts'
import { pruneCrashReports, RendererConsoleTail, writeCrashReport, type CrashReportSource } from '../../../vendor/deepseek-harness/source/apps/desktop/src/crash-report.ts'
import { connectDesktopSettings, type DesktopSettingsBackend } from '../../../vendor/deepseek-harness/source/apps/desktop/src/desktop-settings.ts'
import { readDesktopLoginShellEnvironment, resolveDesktopLoginShellConfig } from '../../../vendor/deepseek-harness/source/apps/desktop/src/login-shell-environment.ts'
import { DesktopBrowserGuests } from '../../../vendor/deepseek-harness/source/apps/desktop/src/browser-guests.ts'
import { installDesktopShortcuts } from '../../../vendor/deepseek-harness/source/apps/desktop/src/keyboard.ts'
import { DesktopUpdateOverlays } from '../../../vendor/deepseek-harness/source/apps/desktop/src/update-overlay.ts'
import { DesktopQuitConfirmation } from '../../../vendor/deepseek-harness/source/apps/desktop/src/quit-confirmation.ts'
import { closeRendererBeforeQuit } from './desktop-unload.ts'
import { desktopNodeEnvironment } from '../../../vendor/deepseek-harness/source/apps/desktop/src/node-environment.ts'
import { WINDOWS_TITLEBAR_HEIGHT } from '../../../vendor/deepseek-harness/source/apps/desktop/src/windows-layout.ts'

let focusPrimaryWindow = (): void => {}
let stopForRecovery = async (): Promise<void> => {}
let shuttingDown = false
let skipQuitConfirmation = false
let windowsLanguage: string | undefined
let backendReady = false
const rendererConsole = new RendererConsoleTail()
app.setAppLogsPath()
function currentDesktopLocale(): ReturnType<typeof resolveDesktopLocale> {
  const locale = resolveDesktopLocale(windowsLanguage ?? app.getLocale())
  return { ...locale, messages: { ...locale.messages, aboutProduct: 'YouDub',
    quitTitle: locale.id === 'ja' ? 'YouDub を終了しますか？' : locale.id === 'zh-CN' ? '退出 YouDub？' : 'Quit YouDub?' } }
}
function quitWithoutConfirmation(): void { skipQuitConfirmation = true; app.quit() }
function runtimeResources() {
  const dsh = process.env.DSH_DESKTOP_DSH_DIR
  const pnpm = process.env.DSH_DESKTOP_PNPM_ENTRY
  if (!dsh || !pnpm) throw new Error('YouDub Desktop runtime is not prepared. Run desktop.mjs --prepare-only.')
  return { node: process.execPath, nodeBin: join(app.getAppPath(), 'scripts/node-bin'), pnpm, dsh }
}
function persistCrashReport(error: unknown, source: CrashReportSource) {
  return writeCrashReport(app.getPath('logs'), {
    source, phase: backendReady ? 'running' : 'startup', error,
    ...(error instanceof DesktopHostFatalError && error.diagnostic !== undefined ? { hostDiagnostic: error.diagnostic } : {}),
    rendererConsole: rendererConsole.snapshot(),
    app: { name: app.name, version: app.getVersion(), platform: process.platform, arch: process.arch,
      electron: process.versions.electron, node: process.versions.node, locale: currentDesktopLocale().id }, time: new Date(),
  })
}
const recovery = new DesktopFatalRecovery({
  messages: () => currentDesktopLocale().messages,
  show: options => dialog.showMessageBox(options),
  stop: () => { shuttingDown = true; return stopForRecovery() },
  disablePlugins: async () => {
    const backup = await new DesktopProjectManager(resolveDesktopPaths(), runtimeResources()).disableAllPlugins()
    console.info('Desktop profile recovery:', { backup: backup ?? null })
  },
  exit: quitWithoutConfirmation,
  restart: () => { app.relaunch(); quitWithoutConfirmation() }, writeReport: persistCrashReport,
})
function reportFatal(error: unknown, source: CrashReportSource): void {
  console.error(error)
  if (shuttingDown) { void persistCrashReport(error, source).catch(console.error); return }
  void recovery.report(error, source).catch((failure: unknown) => { console.error(failure); app.exit(1) })
}
protocol.registerSchemesAsPrivileged([{ scheme: SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true } }])

// Copied verbatim from upstream apps/desktop/src/main.ts (dsh-v0.2.1-rc.2).
// These private window helpers have no exported API; retain the native security and material behavior.
function chromeFallbackFill(): string {
  return nativeTheme.shouldUseDarkColors ? '#1b1b1c' : '#f9fafb'
}

function createWindow(preload: string, show = false, primary = false): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 520,
    minHeight: 600,
    show,
    ...(process.platform === 'win32' && primary ? {
      titleBarStyle: 'hidden' as const,
      titleBarOverlay: { height: WINDOWS_TITLEBAR_HEIGHT, color: chromeFallbackFill(),
        symbolColor: nativeTheme.shouldUseDarkColors ? '#f9fafb' : '#0f1115' },
    } : {}),
    // hiddenInset places traffic lights inside the sidebar; sidebar vibrancy
    // needs a transparent window background to show through the page.
    ...(process.platform === 'darwin' ? {
      titleBarStyle: 'hiddenInset' as const,
      trafficLightPosition: { x: 16, y: 18 },
      vibrancy: 'sidebar' as const,
      // 'active' keeps the vibrancy material stable when the window blurs;
      // 'followWindow' washes the sidebar out behind an unfocused window.
      visualEffectState: 'active' as const,
      backgroundColor: '#00000000',
    } : {}),
    webPreferences: {
      preload,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      webviewTag: primary,
      devTools: true,
    },
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (['http:', 'https:'].includes(new URL(url).protocol)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  if (process.platform === 'darwin' || process.platform === 'win32') {
    // Fullscreen hides native window controls; overlays drop their caption clearance.
    const sendFullscreen = (): void => {
      if (!window.isDestroyed()) window.webContents.send(DESKTOP_IPC.windowFullscreen, window.isFullScreen())
    }
    window.on('enter-full-screen', sendFullscreen)
    window.on('leave-full-screen', sendFullscreen)
    // Reloads and navigations re-register the preload listener; resend the
    // current state so a fullscreen reload does not fall back to windowed CSS.
    window.webContents.on('did-finish-load', sendFullscreen)
  }
  if (process.platform === 'darwin') {
    // Deminiaturize reattaches the NSVisualEffectView material late
    // (electron/electron#25368), so a transparent window shows the desktop
    // through the sidebar until then. Paint an opaque base while minimized or
    // hidden so the deminiaturize animation and the reattachment gap show a
    // solid fill; restoring flips back, and the null -> 'sidebar' transition
    // forces the material to reattach.
    const applyBackdrop = (): void => {
      if (window.isDestroyed()) return
      if (window.isMinimized() || !window.isVisible()) {
        window.setVibrancy(null)
        window.setBackgroundColor(chromeFallbackFill())
      } else {
        window.setVibrancy('sidebar')
        window.setBackgroundColor('#00000000')
      }
    }
    window.on('minimize', applyBackdrop)
    window.on('hide', applyBackdrop)
    window.on('restore', applyBackdrop)
    window.on('show', applyBackdrop)
  }
  window.webContents.on('context-menu', (_event, { isEditable, selectionText, editFlags }) => {
    const items: MenuItemConstructorOptions[] = []
    if (isEditable) {
      items.push(
        { role: 'undo', enabled: editFlags.canUndo },
        { role: 'redo', enabled: editFlags.canRedo },
        { type: 'separator' },
        { role: 'cut', enabled: editFlags.canCut },
        { role: 'copy', enabled: editFlags.canCopy },
        { role: 'paste', enabled: editFlags.canPaste },
        { type: 'separator' },
        { role: 'selectAll', enabled: editFlags.canSelectAll },
      )
    } else if (selectionText.length > 0) {
      items.push({ role: 'copy', enabled: editFlags.canCopy })
    }
    // Empty accelerators suppress Electron's default shortcut labels for native roles.
    if (items.length > 0) {
      const messages = currentDesktopLocale().messages
      Menu.buildFromTemplate(items.map(item => ({
        ...item,
        ...(process.platform === 'win32' && item.role !== undefined && item.role in messages
          ? { label: messages[item.role as keyof typeof messages] } : {}),
        accelerator: '',
      }))).popup({ window })
    }
  })
  window.webContents.on('will-navigate', (event, url) => {
    const destination = new URL(url)
    const current = new URL(window.webContents.getURL())
    if (destination.protocol !== `${SCHEME}:`
      && !(destination.protocol === 'http:' && destination.origin === current.origin)) {
      event.preventDefault()
      if (['http:', 'https:'].includes(destination.protocol)) void shell.openExternal(url)
    }
  })
  return window
}

async function main(): Promise<void> {
  await pruneCrashReports(app.getPath('logs'))
  const resources = runtimeResources()
  const manifest = JSON.parse(await readFile(join(app.getAppPath(), 'package.json'), 'utf8'))
  const paths = resolveDesktopPaths()
  const manager = new DesktopProjectManager(paths, resources)
  const loginShellRead = new AbortController()
  app.on('will-quit', () => loginShellRead.abort())
  const loginShell = readDesktopLoginShellEnvironment(process.env, resolveDesktopLoginShellConfig(process.env), { signal: loginShellRead.signal })
    .then(result => {
      for (const failure of result.failures) console.warn(`desktop login shell: ${failure.shell} failed (${failure.reason})`)
      return result.environment
    })
  let hostEnvironment = process.env
  let quitting = false
  let closingRenderer = false
  let sessionEnding = false
  let mainWindow: BrowserWindow | undefined
  let hostUrl: string | undefined
  let hostCookie: string | undefined
  let injections: readonly unknown[] = []
  let metadata: DesktopSettingsBackend | undefined
  const systemLanguages = app.getPreferredSystemLanguages()
  let locale = resolveDesktopStartupLocale(null, systemLanguages)
  windowsLanguage = locale.id
  const applicationUrl = `${SCHEME}://app/`
  const browserGuests = new DesktopBrowserGuests(() => hostUrl)
  const updateOverlays = new DesktopUpdateOverlays()
  const assertProductSender = (event: IpcMainInvokeEvent): void => {
    assertDesktopSender(event, ['app'])
    if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents
      || event.senderFrame !== mainWindow.webContents.mainFrame) throw new Error('YouDub Desktop rejected IPC from an unowned renderer')
  }
  const backend = new DesktopBackendController(onFailure => {
    const host = new DesktopHostProcess(resources.node, resources.dsh, paths.profile, undefined,
      { ...hostEnvironment, DSH_CLIENT_VERSION: manifest.harnessRuntimeVersion }, onFailure,
      resources)
    return {
      start: async () => {
        const ready = await host.start()
        hostCookie = await authenticateWebHost(ready.url)
        hostUrl = ready.url
        if (ready.injections === undefined) throw new Error('Desktop Host did not provide boot injections')
        injections = ready.injections
        // Reuse the official authenticated metadata transport. Authentication never chooses the product entry page.
        metadata = await connectDesktopSettings(ready.url, (input, init) => net.fetch(input, init))
        locale = resolveDesktopStartupLocale(await metadata.readLocalePreference(), systemLanguages)
        windowsLanguage = locale.id
      },
      stop: () => host.stop(true), inspectQuit: () => host.inspectQuit(),
    }
  }, state => {
    if (state.phase === 'error') reportFatal(state.failure, 'host')
    else if (!shuttingDown) backendReady = state.phase === 'ready'
  })
  stopForRecovery = () => backend.close()
  // Protocol and websocket forwarding follow upstream main.ts. Credentials remain in the main process.
  protocol.handle(SCHEME, request => {
    const url = new URL(request.url)
    if (url.hostname === 'shell') return serveWebDocument(request, join(app.getAppPath(), 'renderer'))
    if (url.hostname === 'app') {
      if (url.pathname === '/' || url.pathname === '/index.html' || url.pathname.startsWith('/assets/')
        || ['/favicon.svg', '/manifest.webmanifest'].includes(url.pathname)) {
        return serveWebDocument(request, join(resources.dsh, 'node_modules/@deepseek-ai/dsh-web-frontend/dist'))
      }
      if (!backend.host || !hostUrl || !hostCookie) return Promise.resolve(new Response(null, { status: 503 }))
      return forwardWebRequest(request, hostUrl, hostCookie)
    }
    return Promise.resolve(new Response(null, { status: 404 }))
  })
  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ['ws://127.0.0.1/*', 'wss://127.0.0.1/*'] }, (details, callback) => {
    if (!hostUrl || !hostCookie || details.webContentsId !== mainWindow?.webContents.id) { callback({}); return }
    const target = new URL(hostUrl), requested = new URL(details.url)
    if (requested.host !== target.host || requested.protocol !== (target.protocol === 'https:' ? 'wss:' : 'ws:')) { callback({}); return }
    const headers = Object.fromEntries(Object.entries(details.requestHeaders).map(([name, value]) => [name.toLowerCase(), value]))
    if (headers.origin !== 'dsh-app://app') { callback({ cancel: true }); return }
    callback({ requestHeaders: { ...headers, origin: target.origin, cookie: hostCookie, 'sec-fetch-site': 'same-origin' } })
  })
  const refreshApplicationMenu = (): void => {
    const mac = process.platform === 'darwin'
    const items: MenuItemConstructorOptions[] = [
      { label: 'YouDub', submenu: applicationItems() },
      ...(mac ? [shortcuts.fileMenu(currentDesktopLocale().messages)] : []),
      { role: 'editMenu' }, { role: 'windowMenu' },
    ]
    Menu.setApplicationMenu(Menu.buildFromTemplate(items))
  }
  const applicationItems = (): MenuItemConstructorOptions[] => [
    { role: 'about', label: locale.id === 'ja' ? 'YouDub について' : locale.id === 'zh-CN' ? '关于 YouDub' : 'About YouDub' },
    { type: 'separator' }, { role: 'reload' }, { role: 'toggleDevTools', visible: false },
    ...(process.platform === 'darwin' ? [{ role: 'hide' as const }, { role: 'hideOthers' as const }, { role: 'unhide' as const }, { type: 'separator' as const }] : []),
    { role: 'quit' },
  ]
  installDesktopDirectoryPicker(() => mainWindow)
  // Retain the official media permission boundary even without a recording UI.
  installMicrophonePermissions(session.defaultSession, () => mainWindow?.webContents)
  const shortcuts = installDesktopShortcuts(() => mainWindow, app.getPath('userData'),
    process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'windows' : 'linux',
    refreshApplicationMenu, window => updateOverlays.input(window))
  app.on('will-quit', () => shortcuts.dispose())
  app.setAboutPanelOptions({ applicationName: 'YouDub', applicationVersion: manifest.version, version: '', copyright: '' })
  const startup = backend.start(async () => {
    const pluginRoot = process.env.YOUDUB_HARNESS_PLUGIN_ROOT
    if (!pluginRoot) throw new Error('YouDub source plugin is not prepared. Run desktop.mjs.')
    await prepareYouDubProfile(paths.profile, pluginRoot, resources.dsh, { command: resources.node, args: ['--expose-internals', resources.pnpm], env: desktopNodeEnvironment(resources.node, resources.nodeBin, process.env) })
    await manager.applyRelease()
    await assertYouDubProfile(paths.profile, join(resources.dsh, 'package.json'))
    hostEnvironment = await loginShell
    // Product paths must win over login-shell variables during source development.
    hostEnvironment = { ...hostEnvironment, DSH_HOME: process.env.DSH_HOME,
      YOUDUB_MEDIA_ROOT: process.env.YOUDUB_MEDIA_ROOT, YOUDUB_NODE_PATH: process.env.YOUDUB_NODE_PATH }
  })
  ipcMain.handle(DESKTOP_IPC.boot, async event => {
    assertProductSender(event); await startup
    if (!backend.host || !hostUrl) throw new Error('Desktop Host is unavailable')
    return { injections, streamBaseUrl: new URL(hostUrl).origin }
  })
  ipcMain.handle(DESKTOP_IPC.bootFailed, (event, message: unknown) => {
    assertProductSender(event)
    if (typeof message !== 'string') throw new Error('Desktop startup failure must be text')
    reportFatal(new Error(message), 'web-boot')
  })
  ipcMain.handle(DESKTOP_IPC.browserAcquire, (event, workspace: unknown) => { assertProductSender(event); return browserGuests.acquire(event.sender, workspace) })
  ipcMain.handle(DESKTOP_IPC.browserRelease, (event, lease: unknown) => { assertProductSender(event); return browserGuests.release(event.sender, lease) })
  ipcMain.on(DESKTOP_IPC.nativeThemeSet, (event, source: unknown) => {
    assertProductSender(event)
    if (source !== 'light' && source !== 'dark' && source !== 'system') throw new Error('Invalid native theme')
    nativeTheme.themeSource = source
  })
  ipcMain.handle(DESKTOP_IPC.localeBootstrap, async event => {
    assertProductSender(event); await startup
    if (!metadata) throw new Error('Desktop metadata is unavailable')
    return { languages: systemLanguages, preference: await metadata.readLocalePreference() }
  })
  ipcMain.on(DESKTOP_IPC.localeChanged, (event, next: unknown) => {
    assertProductSender(event)
    if (typeof next !== 'string') throw new Error('Invalid Desktop locale')
    locale = resolveDesktopStartupLocale(next, systemLanguages); windowsLanguage = locale.id
    refreshApplicationMenu()
  })
  ipcMain.handle(DESKTOP_IPC.deviceInfo, event => { assertProductSender(event); return readDeviceInfo() })
  // No YouDub release feed exists for this workspace development shell. Idle means no running update.
  ipcMain.handle(DESKTOP_IPC.updatesStatus, event => { assertProductSender(event); return { phase: 'idle' } })
  ipcMain.handle(DESKTOP_IPC.updatesOpen, async event => {
    assertProductSender(event)
    await dialog.showMessageBox(mainWindow!, { type: 'info', title: 'YouDub',
      message: locale.id === 'zh-CN' ? '当前开发版本尚未配置更新源。' : 'This development build has no update source configured.' })
  })

  // Copied verbatim from upstream apps/desktop/src/main.ts.
  if (process.platform === 'win32') {
    ipcMain.handle(DESKTOP_IPC.windowsMenu, (event, name: unknown, x: unknown, y: unknown) => {
      assertDesktopSender(event, ['app'])
      if (mainWindow === undefined || event.sender !== mainWindow.webContents
        || event.senderFrame !== mainWindow.webContents.mainFrame) throw new Error('desktop menu: rejected sender')
      if ((name !== 'application' && name !== 'edit')
        || typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)
        || x < 0 || y < 0 || x > 100_000 || y > 100_000) throw new Error('desktop menu: invalid popup request')
      const window = mainWindow
      // Editor-owned history listens to key events rather than Chromium's native undo stack.
      const editItem = (label: string, keyCode: string, modifiers: Array<'control'>, accelerator?: string): MenuItemConstructorOptions => ({
        label,
        ...(accelerator === undefined ? {} : { accelerator }),
        click: () => {
          shortcuts.sendEditingKey(keyCode, modifiers)
        },
      })
      const items: MenuItemConstructorOptions[] = name === 'application' ? applicationItems() : [
        editItem(currentDesktopLocale().messages.undo, 'Z', ['control'], 'Ctrl+Z'),
        editItem(currentDesktopLocale().messages.redo, 'Y', ['control'], 'Ctrl+Y'),
        { type: 'separator' },
        editItem(currentDesktopLocale().messages.cut, 'X', ['control'], 'Ctrl+X'),
        editItem(currentDesktopLocale().messages.copy, 'C', ['control'], 'Ctrl+C'),
        editItem(currentDesktopLocale().messages.paste, 'V', ['control'], 'Ctrl+V'),
        editItem(currentDesktopLocale().messages.delete, 'Delete', []),
        { type: 'separator' },
        editItem(currentDesktopLocale().messages.selectAll, 'A', ['control'], 'Ctrl+A'),
      ]
      const zoom = mainWindow.webContents.getZoomFactor()
      return new Promise<void>((resolve) => {
        Menu.buildFromTemplate(items).popup({ window, x: Math.round(x * zoom), y: Math.round(y * zoom), callback: resolve })
      })
    })
    ipcMain.on(DESKTOP_IPC.windowsAppearance, (event, language: unknown, color: unknown, symbolColor: unknown) => {
      if (mainWindow === undefined || event.sender !== mainWindow.webContents
        || event.senderFrame !== mainWindow.webContents.mainFrame) return
      if (!event.senderFrame.url.startsWith(`${SCHEME}://app/`)) return
      if (typeof language === 'string' && /^[a-zA-Z]+(?:-[a-zA-Z0-9]+)*$/u.test(language)) {
        windowsLanguage = language
      }
      // Empty colors precede client stylesheet installation; only CSS color values cross IPC.
      const validColor = (value: unknown): value is string => typeof value === 'string'
        && /^(?:#[\da-f]{3,8}|rgba?\([\d.,%\s]+\))$/iu.test(value)
      if (validColor(color) && validColor(symbolColor)) mainWindow.setTitleBarOverlay({ color, symbolColor })
    })
  }


  const quitConfirmation = new DesktopQuitConfirmation({
    locale: currentDesktopLocale, inspect: () => backend.host?.inspectQuit(),
    show: options => dialog.showMessageBox(options),
    focus: () => { if (process.platform === 'darwin') app.focus({ steal: true }) },
  })
  const finishQuit = async (): Promise<void> => {
    if (quitting) return
    quitting = true; shuttingDown = true; quitConfirmation.dispose()
    mainWindow?.hide()
    try { await stopForRecovery(); app.quit() }
    catch (error) { await persistCrashReport(error, 'main'); console.error(error); app.exit(1) }
  }
  app.on('before-quit', event => {
    if (quitting) return
    event.preventDefault()
    if (skipQuitConfirmation || sessionEnding) { void finishQuit(); return }
    if (closingRenderer) return
    void quitConfirmation.confirm().then(async approved => {
      if (!approved || closingRenderer || quitting) return
      const window = mainWindow
      closingRenderer = true
      try {
        const discarded = !window || await closeRendererBeforeQuit(window, () => {
          const { messages } = currentDesktopLocale()
          return dialog.showMessageBoxSync(window, {
            type: 'warning', title: messages.aboutProduct, message: messages.quitTitle,
            detail: messages.quitUnsavedChanges,
            buttons: [messages.quit, messages.cancel], defaultId: 1, cancelId: 1, noLink: true,
          }) === 0
        })
        if (discarded) await finishQuit()
        else focusPrimaryWindow()
      } finally { closingRenderer = false }
    })
      .catch(error => reportFatal(error, 'main'))
  })
  if (process.platform !== 'win32') powerMonitor.on('shutdown', () => { sessionEnding = true })
  const createMainWindow = (): BrowserWindow => {
    const window = createWindow(join(app.getAppPath(), 'lib/preload-app.cjs'), false, true)
    mainWindow = window
    browserGuests.bind(window, (guest, name) => shortcuts.attachGuest(window, guest, name))
    shortcuts.attach(window)
    window.on('close', event => {
      if (quitting || sessionEnding || closingRenderer) return
      event.preventDefault()
      if (process.platform !== 'darwin') { app.quit(); return }
      if (window.isFullScreen()) {
        window.once('leave-full-screen', () => { if (!window.isDestroyed()) window.hide() })
        window.setFullScreen(false)
      } else window.hide()
    })
    window.on('session-end', () => { sessionEnding = true })
    window.on('focus', () => { sessionEnding = false })
    window.on('show', () => { sessionEnding = false })
    window.on('closed', () => { if (mainWindow === window) mainWindow = undefined })
    window.webContents.on('console-message', details => {
      if (details.level === 'error') rendererConsole.push(`${details.sourceId}:${String(details.lineNumber)} ${details.message}`)
    })
    window.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
      if (isMainFrame && code !== -3 && !quitting && !window.isDestroyed()) reportFatal(new Error(`Desktop page failed to load: ${url} (${code}: ${description})`), 'renderer')
    })
    window.webContents.on('preload-error', (_event, _path, error) => { if (!quitting) reportFatal(error, 'renderer') })
    window.webContents.on('render-process-gone', (_event, details) => {
      if (!quitting && details.reason !== 'clean-exit') reportFatal(new Error(`Desktop renderer exited: ${details.reason}`), 'renderer')
    })
    return window
  }
  focusPrimaryWindow = () => {
    if (quitting || recovery.active) return
    const window = mainWindow
    if (!window || window.isDestroyed()) return
    if (window.isMinimized()) window.restore()
    window.show(); window.focus()
  }
  app.on('activate', () => focusPrimaryWindow())
  app.on('window-all-closed', () => { if (process.platform !== 'darwin' && !closingRenderer && !quitting) app.quit() })
  // Product startup is independent of account/key state. YouDub SetupGate owns its first run.
  const window = createMainWindow()
  const navigation = window.loadURL(applicationUrl)
  await Promise.all([startup, navigation])
  refreshApplicationMenu()
  if (!quitting && !recovery.active && !window.isDestroyed()) { window.show(); window.focus() }
}

if (claimDesktopSingleInstance(app, () => focusPrimaryWindow())) {
  void app.whenReady().then(main).catch(error => reportFatal(error, 'main'))
}
