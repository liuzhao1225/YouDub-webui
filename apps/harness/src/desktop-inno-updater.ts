import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { existsSync } from 'node:fs'
import { app } from 'electron'
import { NsisUpdater } from 'electron-updater'

/** Keep the existing Inno AppId; reuse electron-updater's EXE download, cache and SHA-512 verification. */
export class YouDubInnoUpdater extends NsisUpdater {
  override quitAndInstall(): void {
    if (this.quitAndInstallCalled) return
    const installer = this.installerPath
    if (!installer) throw new Error('YouDub update: no verified installer is ready')
    const directory = dirname(app.getPath('exe'))
    if (!existsSync(join(directory, 'unins000.exe'))) throw new Error('YouDub update: install the Windows Setup edition before using automatic updates')
    this.quitAndInstallCalled = true
    // Inno waits for this PID before replacing files and launches the new app only on success.
    // Do not suppress installer error dialogs: after Electron exits, Inno owns diagnostics.
    const child = spawn(installer, ['/VERYSILENT', '/NORESTART', '/SP-', '/YOUDUBUPDATE=1',
      `/UPDATEPID=${process.pid}`, `/UPDATEUSERDATA=${app.getPath('userData')}`, `/DIR=${directory}`, `/LOG=${join(app.getPath('logs'), 'update-install.log')}`],
    { detached: true, stdio: 'ignore', windowsHide: true })
    child.once('error', error => { this.quitAndInstallCalled = false; this.emit('error', error) })
    child.once('spawn', () => { child.unref(); app.quit() })
  }
}
