import { EventEmitter } from 'node:events'
import { describe, it, expect, vi } from 'vitest'
import type { AppUpdater } from 'electron-updater'
import type { DesktopUpdateState } from '../src/ipc.ts'
vi.mock('electron', () => ({ app: {} }))
vi.mock('electron-updater', () => ({ default: { autoUpdater: {} } }))
vi.mock('../src/update-http-executor.ts', () => ({ DesktopUpdateHttpExecutor: class {} }))
import { DesktopUpdateCoordinator } from '../src/update-coordinator.ts'

function fixture() {
  const states: DesktopUpdateState[] = []
  const updater = Object.assign(new EventEmitter(), {
    checkForUpdates: vi.fn(async () => ({ isUpdateAvailable: true, updateInfo: { version: '1.0.1' } })),
    downloadUpdate: vi.fn(async () => {
      updater.emit('download-progress', { percent: 50 })
      updater.emit('download-progress', { percent: 100 })
      updater.emit('update-downloaded', { version: '1.0.1' })
      return []
    }),
    quitAndInstall: vi.fn(),
  })
  const beforeRestart = vi.fn(async () => true)
  const coordinator = new DesktopUpdateCoordinator(state => { states.push(state); return state }, beforeRestart,
    updater as unknown as AppUpdater, () => true, () => '1.0.0')
  return { coordinator, updater, states, beforeRestart }
}

describe('YouDub automatic download with dsh coordinator', () => {
  it('joins checks/downloads, reports verification and retains a prepared package without installing', async () => {
    const f = fixture()
    await Promise.all([f.coordinator.check(), f.coordinator.check(true)])
    expect(f.updater.checkForUpdates).toHaveBeenCalledTimes(1)
    expect(f.updater.downloadUpdate).toHaveBeenCalledTimes(1)
    expect(f.states.map(s => s.phase)).toEqual(['checking', 'available', 'downloading', 'downloading', 'verifying', 'ready'])
    expect(f.updater.quitAndInstall).not.toHaveBeenCalled()
    await f.coordinator.check()
    expect(f.updater.downloadUpdate).toHaveBeenCalledTimes(1)
    expect(f.updater).toMatchObject({ autoDownload: false, autoInstallOnAppQuit: false, disableDifferentialDownload: true })
    f.coordinator.dispose()
  })
  it('keeps checksum/network failures visible without automatic redownload', async () => {
    const f = fixture()
    f.updater.downloadUpdate.mockRejectedValue(new Error('SHA512 checksum mismatch'))
    await f.coordinator.check()
    expect(f.coordinator.state).toMatchObject({ phase: 'error', failedOperation: 'download', message: 'SHA512 checksum mismatch' })
    await f.coordinator.check()
    expect(f.updater.downloadUpdate).toHaveBeenCalledTimes(1)
    expect(f.updater.quitAndInstall).not.toHaveBeenCalled()
    f.coordinator.dispose()
  })
  it('refuses stale or unprepared targets and only installs after restart admission', async () => {
    const f = fixture()
    await expect(f.coordinator.install('1.0.1')).rejects.toThrow('not ready')
    await f.coordinator.check()
    await expect(f.coordinator.install('1.0.2')).rejects.toThrow('not ready')
    f.beforeRestart.mockResolvedValueOnce(false)
    expect(await f.coordinator.install('1.0.1')).toMatchObject({ phase: 'ready' })
    expect(f.updater.quitAndInstall).not.toHaveBeenCalled()
    await f.coordinator.install('1.0.1')
    expect(f.updater.quitAndInstall).toHaveBeenCalledWith(true, true)
    f.updater.emit('error', new Error('native installer failed'))
    expect(f.coordinator.state).toMatchObject({ phase: 'error', failedOperation: 'install', message: 'native installer failed' })
    f.coordinator.dispose()
  })
  it('surfaces a failed task inspection and never hands off installation', async () => {
    const f = fixture()
    await f.coordinator.check()
    f.beforeRestart.mockRejectedValue(new Error('inspection timed out'))
    await f.coordinator.install('1.0.1')
    expect(f.coordinator.state).toMatchObject({ phase: 'error', message: 'inspection timed out' })
    expect(f.updater.quitAndInstall).not.toHaveBeenCalled()
    f.coordinator.dispose()
  })
})
