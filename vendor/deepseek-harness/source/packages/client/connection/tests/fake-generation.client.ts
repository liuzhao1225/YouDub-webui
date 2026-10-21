/** Test-local programmable Connection generation source. */
import type { ConnectionGenerationSource } from '../src/client/connection.ts'

type StreamItem = { kind: 'end' } | { kind: 'fail'; error: unknown }

interface StreamConnection {
  feed(item: StreamItem): void
}

/** Hand-pumped generation source for Connection lifecycle tests. */
export class FakeGenerationSource {
  private readonly connections: StreamConnection[] = []

  /** When true, the source never reports ready. */
  suppressReady = false

  /** When true, ready callbacks remain parked until the test releases them. */
  holdReady = false

  private heldReady: Array<() => void> = []

  /** Open one generation. */
  readonly source: ConnectionGenerationSource = (signal, ready) => this.open(signal, ready)

  /** Release every generation currently parked before readiness. */
  releaseReady(): void {
    const held = this.heldReady
    this.heldReady = []
    for (const fire of held) fire()
  }

  /** End every active generation normally. */
  end(): void {
    for (const connection of [...this.connections]) connection.feed({ kind: 'end' })
  }

  /** Fail every active generation. */
  fail(error: unknown): void {
    for (const connection of [...this.connections]) connection.feed({ kind: 'fail', error })
  }

  /** Number of currently active generations. */
  get activeCount(): number {
    return this.connections.length
  }

  private async open(
    signal: AbortSignal,
    onReady: (host: { readonly home: string }) => void,
  ): Promise<void> {
    const inbox: StreamItem[] = []
    let wake: (() => void) | null = null
    const connection: StreamConnection = {
      feed: (item) => {
        inbox.push(item)
        wake?.()
      },
    }
    this.connections.push(connection)
    const ready = (): void => { onReady({ home: '/h' }) }
    if (this.holdReady) this.heldReady.push(ready)
    else if (!this.suppressReady) ready()
    try {
      while (!signal.aborted) {
        while (inbox.length > 0) {
          const item = inbox.shift() as StreamItem
          if (item.kind === 'end') return
          if (item.kind === 'fail') throw item.error
        }
        await new Promise<void>((resolve) => {
          wake = resolve
          signal.addEventListener('abort', () => { resolve() }, { once: true })
        })
        wake = null
      }
    } finally {
      this.connections.splice(this.connections.indexOf(connection), 1)
    }
  }
}
