import type { MessageBoxOptions, MessageBoxReturnValue } from 'electron'
import type { DesktopUpdateState } from '../../../vendor/deepseek-harness/source/apps/desktop/src/ipc.ts'
import type { DesktopUpdateCoordinator } from '../../../vendor/deepseek-harness/source/apps/desktop/src/update-coordinator.ts'
import { formatDesktopMessage, type resolveDesktopLocale } from '../../../vendor/deepseek-harness/source/apps/desktop/src/locale.ts'

/** Native presentation around dsh's version-bound download/install coordinator. */
export class DesktopUpdates {
  private opening: Promise<void> | undefined
  private announced: string | undefined

  constructor(private readonly options: {
    version: string
    coordinator: Pick<DesktopUpdateCoordinator, 'state' | 'check' | 'download' | 'install'>
    locale: () => ReturnType<typeof resolveDesktopLocale>
    show: (options: MessageBoxOptions) => Promise<MessageBoxReturnValue>
    visible: () => boolean
    installationErrorHandled?: () => boolean
  }) {}

  get state(): DesktopUpdateState { return this.options.coordinator.state }

  async check(manual = false): Promise<DesktopUpdateState> {
    const state = await this.options.coordinator.check(manual)
    this.promptReady()
    return state
  }

  /** Hidden windows retain the ready indicator and prompt once when next shown. */
  promptReady(): void {
    if (this.state.phase !== 'ready' || this.announced === this.state.version || !this.options.visible() || this.opening) return
    this.announced = this.state.version
    void this.open().catch(error => { console.error('YouDub update prompt:', error) })
  }

  open(): Promise<void> {
    if (this.opening) return this.opening
    this.opening = this.present().finally(() => { this.opening = undefined; this.promptReady() })
    return this.opening
  }

  private async present(): Promise<void> {
    const { coordinator } = this.options
    const { messages } = this.options.locale()
    const base = { title: messages.updateTitle, noLink: true }
    let state = this.state
    if (state.phase === 'idle' || state.phase === 'available' || state.phase === 'checking'
      || (state.phase === 'error' && state.failedOperation === 'check')) state = await coordinator.check(true)
    else if (state.phase === 'error' && state.failedOperation === 'download' && state.version) state = await coordinator.download(state.version)
    if (state.phase === 'ready' || (state.phase === 'error' && state.failedOperation === 'install')) {
      this.announced = state.version
      const choice = await this.options.show({ ...base, type: 'info',
        message: formatDesktopMessage(messages.updateReady, { version: state.version! }),
        buttons: [messages.updateRestart, messages.updateLater], defaultId: 0, cancelId: 1 })
      if (choice.response !== 0) return
      state = await coordinator.install(state.version!)
      if (state.phase !== 'error') return
      if (this.options.installationErrorHandled?.()) return
    }
    if (state.phase === 'error') {
      await this.options.show({ ...base, type: 'error', message: messages.updateFailed,
        detail: state.message, buttons: [messages.updateClose] })
    } else if (state.phase === 'idle') {
      await this.options.show({ ...base, type: 'info', message: messages.updateCurrent,
        detail: formatDesktopMessage(messages.updateCurrentDetail, { version: this.options.version }), buttons: [messages.updateClose] })
    } else if (state.phase === 'downloading' || state.phase === 'verifying') {
      await this.options.show({ ...base, type: 'info', message: messages.updateDownloading,
        buttons: [messages.updateClose] })
    }
  }
}
