import { existsSync, rmSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { join } from 'node:path'

const openerUrl = new URL('./open.mjs', import.meta.url).href
const exitMarker = join(process.cwd(), `.dsh-browser-open-${process.pid}`)

const markerPoll = setInterval(() => {
  if (!existsSync(exitMarker)) return
  rmSync(exitMarker, { force: true })
  process.exit(0)
}, 25)
markerPoll.unref()

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'open') return { shortCircuit: true, url: openerUrl }
    return nextResolve(specifier, context)
  },
})

// The SSH case has no opener helper to stop the long-lived Web process.
if (process.env.DSH_BROWSER_OPEN_TEST_EXIT_ON_READY === '1') {
  const originalLog = console.log
  console.log = (...args) => {
    originalLog(...args)
    if (typeof args[0] === 'string' && args[0].startsWith('dsh web: ')) {
      setTimeout(() => process.exit(0), 250)
    }
  }
}

if (process.env.DSH_BROWSER_OPEN_TEST_EXIT_ON_FAILURE === '1') {
  const originalError = console.error
  console.error = (...args) => {
    originalError(...args)
    if (typeof args[0] === 'string' && args[0].startsWith('web-app: could not open the default browser because ')) {
      setTimeout(() => process.exit(0), 0)
    }
  }
}
