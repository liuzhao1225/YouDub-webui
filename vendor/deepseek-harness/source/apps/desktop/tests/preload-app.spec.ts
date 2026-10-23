// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { syncWindowsAppearance } from '../src/preload-windows.ts'
import { DESKTOP_IPC, type DshDesktopProductApi } from '../src/ipc.ts'

const electron = vi.hoisted(() => ({
  contextBridge: { exposeInMainWorld: vi.fn() },
  ipcRenderer: { invoke: vi.fn(), on: vi.fn(), off: vi.fn(), send: vi.fn() },
  webUtils: { getPathForFile: vi.fn() },
}))
vi.mock('electron', () => electron)
vi.mock('../src/preload-platform.ts', () => ({ markDocumentPlatform: vi.fn(), syncWindowFullscreen: vi.fn() }))
vi.mock('../src/preload-theme.ts', () => ({ syncNativeTheme: vi.fn() }))
vi.mock('../src/preload-windows.ts', () => ({ syncWindowsAppearance: vi.fn() }))

beforeEach(() => { vi.stubGlobal('process', { ...process, isMainFrame: true }) })
afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks(); vi.resetModules() })

it('does not expose retired account or onboarding bridges', async () => {
  vi.stubGlobal('location', new URL('dsh-app://app/'))
  await import('../src/preload-app.ts')
  const names = electron.contextBridge.exposeInMainWorld.mock.calls.map(([name]) => name)
  expect(names).not.toContain('dshOnboarding')
  expect(names).not.toContain('dshPlatform')
  expect(electron.ipcRenderer.invoke).not.toHaveBeenCalled()
})

it('exposes update status and download prompts without installation or backend management', async () => {
  vi.stubGlobal('location', new URL('dsh-app://app/index.html'))
  await import('../src/preload-app.ts')
  const api = electron.contextBridge.exposeInMainWorld.mock.calls.find(([name]) => name === 'dshDesktop')?.[1] as DshDesktopProductApi
  expect(Object.keys(api.updates).sort()).toEqual(['open', 'status', 'subscribe'])
  expect(api).not.toHaveProperty('plugins')
  expect(api).not.toHaveProperty('backend')
  expect(electron.ipcRenderer.invoke).not.toHaveBeenCalled()
  await api.updates.status()
  await api.updates.open()
  expect(electron.ipcRenderer.invoke.mock.calls).toEqual([[DESKTOP_IPC.updatesStatus], [DESKTOP_IPC.updatesOpen]])
  const listener = vi.fn()
  const unsubscribe = api.updates.subscribe(listener)
  const handler = electron.ipcRenderer.on.mock.calls.find(([name]) => name === DESKTOP_IPC.updatesChanged)![1]
  const state = { status: 'available', version: '0.0.9' }
  handler({}, state)
  expect(listener).toHaveBeenCalledWith(state)
  unsubscribe()
  expect(electron.ipcRenderer.off).toHaveBeenCalledWith(DESKTOP_IPC.updatesChanged, handler)
})

it.each(['dsh-app://shell/plugin-manager.html', 'dsh-app://other/index.html', 'https://shell/startup.html', 'http://example.com/'])('exposes only the carrier marker to %s', async (url) => {
  vi.stubGlobal('location', new URL(url))
  await import('../src/preload-app.ts')
  expect(electron.contextBridge.exposeInMainWorld).toHaveBeenCalledWith('dshDesktop', { protocolVersion: 1 })
})

it('reads the local machine description only from the application main frame', async () => {
  const description = 'platform=darwin; os=15.6; app_arch=arm64; cpu=Apple M4; memory_gib=32.0'
  vi.stubGlobal('location', new URL('dsh-app://app/index.html'))
  electron.ipcRenderer.invoke.mockResolvedValue(description)
  await import('../src/preload-app.ts')
  const api = electron.contextBridge.exposeInMainWorld.mock.calls.find(([name]) => name === 'dshDesktop')?.[1] as DshDesktopProductApi
  await expect(api.deviceInfo()).resolves.toBe(description)
  expect(electron.ipcRenderer.invoke).toHaveBeenCalledExactlyOnceWith(DESKTOP_IPC.deviceInfo)
  vi.resetModules()
  electron.contextBridge.exposeInMainWorld.mockClear()
  vi.stubGlobal('process', { ...process, isMainFrame: false })
  await import('../src/preload-app.ts')
  expect(electron.contextBridge.exposeInMainWorld).toHaveBeenCalledWith('dshDesktop', { protocolVersion: 1 })
})

it('exposes asynchronous boot only to the local application document', async () => {
  vi.stubGlobal('location', new URL('dsh-app://app/'))
  await import('../src/preload-app.ts')
  const api = electron.contextBridge.exposeInMainWorld.mock.calls.find(([name]) => name === 'dshDesktopBoot')?.[1] as { ready(): Promise<unknown>; failed(message: string): Promise<void> }
  await api.ready()
  await api.failed('client mount failed')
  expect(electron.ipcRenderer.invoke).toHaveBeenCalledWith(DESKTOP_IPC.bootFailed, 'client mount failed')
  expect(electron.ipcRenderer.invoke).toHaveBeenCalledWith(DESKTOP_IPC.boot)
  vi.resetModules()
  electron.contextBridge.exposeInMainWorld.mockClear()
  vi.stubGlobal('location', new URL('https://other.example/'))
  await import('../src/preload-app.ts')
  expect(electron.contextBridge.exposeInMainWorld.mock.calls.some(([name]) => name === 'dshDesktopBoot')).toBe(false)
})

it('exposes a directory picker only to the local application document', async () => {
  vi.stubGlobal('location', new URL('dsh-app://app/'))
  await import('../src/preload-app.ts')
  const api = electron.contextBridge.exposeInMainWorld.mock.calls.find(([name]) => name === '__DSH_DIRECTORY_PICKER__')?.[1] as { pick(): Promise<string | null> }
  electron.ipcRenderer.invoke.mockResolvedValue('/workspace')
  await expect(api.pick()).resolves.toBe('/workspace')
  expect(electron.ipcRenderer.invoke).toHaveBeenCalledExactlyOnceWith(DESKTOP_IPC.directoryPick)
  for (const url of ['dsh-app://shell/startup.html', 'https://example.com/']) {
    vi.resetModules()
    electron.contextBridge.exposeInMainWorld.mockClear()
    vi.stubGlobal('location', new URL(url))
    await import('../src/preload-app.ts')
    expect(electron.contextBridge.exposeInMainWorld.mock.calls.some(([name]) => name === '__DSH_DIRECTORY_PICKER__')).toBe(false)
  }
})

it('reports host paths of picked files only to the local application document', async () => {
  vi.stubGlobal('location', new URL('dsh-app://app/'))
  await import('../src/preload-app.ts')
  const api = electron.contextBridge.exposeInMainWorld.mock.calls.find(([name]) => name === '__DSH_HOST_PATHS__')?.[1] as { pathFor(file: File): string }
  const picked = new File(['x'], 'notes.md')
  electron.webUtils.getPathForFile.mockReturnValue('/Users/me/notes.md')
  expect(api.pathFor(picked)).toBe('/Users/me/notes.md')
  expect(electron.webUtils.getPathForFile).toHaveBeenCalledExactlyOnceWith(picked)
  for (const url of ['dsh-app://shell/startup.html', 'https://example.com/']) {
    vi.resetModules()
    electron.contextBridge.exposeInMainWorld.mockClear()
    vi.stubGlobal('location', new URL(url))
    await import('../src/preload-app.ts')
    expect(electron.contextBridge.exposeInMainWorld.mock.calls.some(([name]) => name === '__DSH_HOST_PATHS__')).toBe(false)
  }
})

it.each(['dsh-app://app/', 'dsh-app://shell/plugin-manager.html', 'https://example.com/'])(
  'installs Windows appearance only for the application document (%s)', async (url) => {
    vi.stubGlobal('location', new URL(url))
    await import('../src/preload-app.ts')
    expect(syncWindowsAppearance).toHaveBeenCalledTimes(url === 'dsh-app://app/' ? 1 : 0)
  },
)


it('exposes constrained shortcut operations and releases configuration subscriptions', async () => {
  vi.stubGlobal('location', new URL('dsh-app://app/'))
  await import('../src/preload-app.ts')
  const api = electron.contextBridge.exposeInMainWorld.mock.calls.find(([name]) => name === 'dshDesktop')?.[1] as DshDesktopProductApi
  await api.shortcuts.get([])
  expect(api.shortcuts).not.toHaveProperty('reload')
  await api.shortcuts.recording(true)
  expect(electron.ipcRenderer.invoke).toHaveBeenCalledWith(DESKTOP_IPC.shortcutsGet, [])
  expect(electron.ipcRenderer.invoke).toHaveBeenCalledWith(DESKTOP_IPC.shortcutsRecording, true)
  const listener = vi.fn()
  const off = api.shortcuts.subscribe(listener)
  const handler = electron.ipcRenderer.on.mock.calls.find(([name]) => name === DESKTOP_IPC.shortcutsChanged)![1] as
    (event: unknown, state: unknown) => void
  handler({}, { status: 'ready' })
  expect(listener).toHaveBeenCalledWith({ status: 'ready' })
  off(); expect(electron.ipcRenderer.off).toHaveBeenCalledWith(DESKTOP_IPC.shortcutsChanged, handler)
})

it('withholds the product API from same-origin child frames', async () => {
  vi.stubGlobal('location', new URL('dsh-app://app/'))
  vi.stubGlobal('process', { ...process, isMainFrame: false })
  await import('../src/preload-app.ts')
  expect(electron.contextBridge.exposeInMainWorld).toHaveBeenCalledWith('dshDesktop', { protocolVersion: 1 })
})

it('forwards only the focused product iframe and releases native input subscriptions', async () => {
  vi.stubGlobal('location', new URL('dsh-app://app/'))
  await import('../src/preload-app.ts')
  const api = electron.contextBridge.exposeInMainWorld.mock.calls.find(([name]) => name === 'dshDesktop')?.[1] as DshDesktopProductApi
  const listener = vi.fn()
  const off = api.keyboard.subscribe(listener)
  const handler = electron.ipcRenderer.on.mock.calls.find(([name]) => name === DESKTOP_IPC.shortcutsInput)![1] as
    (event: unknown, state: unknown) => void
  const input = { kind: 'iframe', frameName: 'preview', revision: 'current' }
  handler({}, input)
  const frame = document.createElement('iframe')
  document.body.append(frame)
  frame.name = 'preview'
  frame.focus()
  handler({}, input)
  expect(listener).not.toHaveBeenCalled()
  frame.setAttribute('data-html-preview', '')
  handler({}, { ...input, frameName: 'stale' })
  handler({}, { ...input, frameName: '' })
  expect(listener).not.toHaveBeenCalled()
  handler({}, input)
  expect(listener).toHaveBeenCalledExactlyOnceWith(input)
  frame.remove()
  handler({}, input)
  expect(listener).toHaveBeenCalledTimes(1)
  const menu = { kind: 'menu', commandId: 'page.close', revision: 'current' }
  handler({}, menu)
  expect(listener).toHaveBeenLastCalledWith(menu)
  off()
  expect(electron.ipcRenderer.off).toHaveBeenCalledWith(DESKTOP_IPC.shortcutsInput, handler)
})
