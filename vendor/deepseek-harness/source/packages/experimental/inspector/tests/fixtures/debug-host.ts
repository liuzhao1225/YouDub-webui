/** Child-process fixture whose Host main thread is paused and resumed through the Inspector Worker. */

import { createInterface } from 'node:readline'
import { startInspector } from '../../src/host/bridge/controller.ts'

const inspector = await startInspector({ port: 0, captureFetch: false })

function breakpointProbe(value: number): number {
  const local = value
  return local + 1
}

Object.defineProperty(globalThis, '__inspectorBreakpointProbe', { value: breakpointProbe, configurable: true })
process.stdout.write(`${JSON.stringify(inspector.endpoint)}\n`)

const input = createInterface({ input: process.stdin, terminal: false })
input.on('line', (line) => {
  if (line === 'run') {
    Object.defineProperty(globalThis, '__inspectorBreakpointResult', {
      value: breakpointProbe(41),
      configurable: true,
    })
  }
  if (line === 'stop') {
    input.close()
    void inspector.close().then(() => { process.exit(0) })
  }
})
