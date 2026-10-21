/** Incremental UTF-8 parser for Server-Sent Events carried by captured responses. */

import type { InspectorEventSourceMessage } from './observation.ts'

/** Parse response bytes into consumer-neutral Server-Sent Event messages. */
export class InspectorEventSourceParser {
  private readonly decoder = new TextDecoder()
  private line = ''
  private eventName = ''
  private eventId = ''
  private data = ''
  private afterCarriageReturn = false

  /**
   * Consume one response-body chunk.
   * @param bytes - Next bytes in response order.
   * @returns Complete events terminated by an empty line in this chunk.
   */
  push(bytes: Uint8Array): readonly InspectorEventSourceMessage[] {
    return this.consume(this.decoder.decode(bytes, { stream: true }))
  }

  private consume(chunk: string): InspectorEventSourceMessage[] {
    const messages: InspectorEventSourceMessage[] = []
    let start = 0
    for (let index = 0; index < chunk.length; index++) {
      if (this.afterCarriageReturn && chunk[index] === '\n') {
        this.afterCarriageReturn = false
        start = index + 1
        continue
      }
      this.afterCarriageReturn = false
      if (chunk[index] !== '\r' && chunk[index] !== '\n') continue
      this.line += chunk.slice(start, index)
      const message = this.parseLine()
      if (message !== undefined) messages.push(message)
      this.line = ''
      start = index + 1
      this.afterCarriageReturn = chunk[index] === '\r'
    }
    this.line += chunk.slice(start)
    return messages
  }

  private parseLine(): InspectorEventSourceMessage | undefined {
    if (this.line.length === 0) {
      const data = this.data
      this.data = ''
      const eventName = this.eventName
      this.eventName = ''
      if (data.length === 0) return undefined
      return {
        eventName: eventName || 'message',
        eventId: this.eventId,
        data: data.slice(0, -1),
      }
    }
    if (this.line.startsWith(':')) return undefined
    const colon = this.line.indexOf(':')
    const field = colon === -1 ? this.line : this.line.slice(0, colon)
    let value = colon === -1 ? '' : this.line.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    switch (field) {
      case 'event':
        this.eventName = value
        return undefined
      case 'data':
        this.data += `${value}\n`
        return undefined
      case 'id':
        if (!value.includes('\0')) this.eventId = value
        return undefined
      default:
        return undefined
    }
  }
}
