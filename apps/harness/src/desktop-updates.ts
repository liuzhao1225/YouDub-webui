import type { MessageBoxOptions, MessageBoxReturnValue } from 'electron'
import type { AvailableUpdate } from '../../../packages/builtin/src/updates.ts'
import type { DesktopUpdateState } from '../../../vendor/deepseek-harness/source/apps/desktop/src/ipc.ts'
import { formatDesktopMessage, type resolveDesktopLocale } from '../../../vendor/deepseek-harness/source/apps/desktop/src/locale.ts'

/** The native shell checks releases; only an explicit action opens the installer URL. */
export class DesktopUpdates {
  state: DesktopUpdateState = { phase: 'idle' }
  private available: AvailableUpdate | null = null
  private checking: Promise<DesktopUpdateState> | undefined
  private opening: Promise<void> | undefined

  constructor(private readonly options: {
    version: string
    check: () => Promise<{ available: AvailableUpdate | null }>
    publish: (state: DesktopUpdateState) => void
    locale: () => ReturnType<typeof resolveDesktopLocale>
    show: (options: MessageBoxOptions) => Promise<MessageBoxReturnValue>
    openExternal: (url: string) => Promise<unknown>
  }) {}

  private set(state: DesktopUpdateState): DesktopUpdateState {
    this.state = state
    this.options.publish(state)
    return state
  }

  check(): Promise<DesktopUpdateState> {
    if (this.checking) return this.checking
    this.set({ phase: 'checking' })
    this.checking = Promise.resolve().then(this.options.check).then(result => {
      this.available = result.available
      return this.set(result.available ? { phase: 'available', version: result.available.version } : { phase: 'idle' })
    }, (error: unknown) => {
      this.available = null
      console.error('YouDub update check:', error)
      return this.set({ phase: 'error', failure: 'check', failedOperation: 'check', message: error instanceof Error ? error.message : String(error) })
    }).finally(() => { this.checking = undefined })
    return this.checking
  }

  open(check: () => Promise<DesktopUpdateState>): Promise<void> {
    if (this.opening) return this.opening
    this.opening = this.present(check).finally(() => { this.opening = undefined })
    return this.opening
  }

  private async present(check: () => Promise<DesktopUpdateState>): Promise<void> {
    const state = await check()
    const { messages } = this.options.locale()
    const base = { title: messages.updateTitle.replace('DeepSeek Harness', 'YouDub'), noLink: true }
    if (state.phase === 'error') {
      await this.options.show({ ...base, type: 'error', message: messages.updateCheckFailedTitle,
        detail: state.message, buttons: [messages.updateClose] })
      return
    }
    const update = this.available
    if (!update) {
      await this.options.show({ ...base, type: 'info', message: messages.updateCurrent,
        detail: formatDesktopMessage(messages.updateCurrentDetail, { version: this.options.version }), buttons: [messages.updateClose] })
      return
    }
    const choice = await this.options.show({ ...base, type: 'info',
      message: formatDesktopMessage(messages.updateAvailable, { version: update.version }),
      detail: messages.updateDetail, buttons: [messages.updateDownload, messages.updateLater], defaultId: 0, cancelId: 1 })
    if (choice.response !== 0) return
    try { await this.options.openExternal(update.download) }
    catch (error) {
      console.error('YouDub installer link:', error)
      await this.options.show({ ...base, type: 'error', message: messages.updateDownloadFailed,
        detail: error instanceof Error ? error.message : String(error), buttons: [messages.updateClose] })
    }
  }
}
