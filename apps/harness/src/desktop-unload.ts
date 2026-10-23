import type { BrowserWindow, Event } from 'electron'

/** Let the existing renderer beforeunload handlers settle before stopping its Host. */
export function closeRendererBeforeQuit(window: BrowserWindow, confirmDiscard: () => boolean): Promise<boolean> {
  if (window.isDestroyed()) return Promise.resolve(true)
  const contents = window.webContents
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      window.removeListener('closed', closed)
      contents.removeListener('will-prevent-unload', prevented)
    }
    const closed = () => { cleanup(); resolve(true) }
    const prevented = (event: Event) => {
      try {
        if (confirmDiscard()) event.preventDefault()
        else { cleanup(); resolve(false) }
      } catch (error) { cleanup(); reject(error) }
    }
    window.once('closed', closed)
    contents.on('will-prevent-unload', prevented)
    try { window.close() } catch (error) { cleanup(); reject(error) }
  })
}
