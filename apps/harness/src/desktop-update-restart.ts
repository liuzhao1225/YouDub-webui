import { DesktopUpdatePreparationError } from '../../../vendor/deepseek-harness/source/apps/desktop/src/update-error.ts'

/** Installation admission uses dsh's Host lock and YouDub's no-interruption rule. */
export async function prepareDesktopUpdateRestart(options: {
  tasks: (action: 'lock' | 'unlock') => Promise<boolean>
  closeRenderer: () => Promise<boolean>
  stop: () => Promise<void>
  activeMessage: string
}): Promise<boolean> {
  let stopped = false
  let failure: unknown
  try {
    if (await options.tasks('lock')) throw new DesktopUpdatePreparationError('tasks-active', options.activeMessage)
    if (!await options.closeRenderer()) return false
    await options.stop()
    stopped = true
    return true
  } catch (error) {
    failure = error
    throw error
  } finally {
    if (!stopped) {
      try { await options.tasks('unlock') }
      catch (unlockError) {
        if (failure) throw new AggregateError([failure, unlockError], `${failure instanceof Error ? failure.message : String(failure)}; admission unlock failed: ${unlockError instanceof Error ? unlockError.message : String(unlockError)}`)
        throw unlockError
      }
    }
  }
}
