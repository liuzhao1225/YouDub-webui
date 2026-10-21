/** The SDK app command provider and stdin shutdown binding. */

import { EventEmitter } from 'node:events'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { internals, provideCmdline } from '@deepseek-ai/dsh-cmdline'
import { apply, type Config, SDK_APP_STARTUP_SERVICE } from '../src/index.ts'

/** Controllable stdin for one startup invocation. */
class TestStdin extends EventEmitter {
  readableEnded = false

  resume(): this {
    return this
  }

  end(): void {
    this.readableEnded = true
    this.emit('end')
  }
}

afterEach(() => {
  internals.stdin = process.stdin
  internals.stdout = process.stdout
  internals.stderr = process.stderr
})

/** Run the provider with captured command output and exit requests. */
function start(args: string[], config: Config = {}): { ctx: Context; exits: number[]; out: () => string; stdin: TestStdin } {
  const ctx = new Context()
  const exits: number[] = []
  const stdin = new TestStdin()
  let out = ''
  const capture = { write: (chunk: string) => { out += chunk; return true } }
  internals.stdin = stdin
  internals.stdout = capture
  internals.stderr = capture
  provideCmdline(ctx, {
    args,
    exit: code => void exits.push(code),
    ready: { onReady: (listener) => { listener(); return () => {} } },
  })
  apply(ctx, config)
  return { ctx, exits, out: () => out, stdin }
}

describe('SDK app startup', () => {
  it('publishes readiness and requests bounded exit on client EOF', async () => {
    const { ctx, exits, stdin } = start([])
    expect(ctx.get(SDK_APP_STARTUP_SERVICE)).toEqual({ accepted: true })
    stdin.end()
    expect(exits).toEqual([0])
    await ctx.fiber.dispose()
  })

  it('prints app help without publishing readiness or binding stdin', () => {
    const { ctx, exits, out, stdin } = start(['--help'])
    expect(out()).toContain('dsh --profile sdk')
    expect(ctx.get(SDK_APP_STARTUP_SERVICE)).toBeUndefined()
    expect(exits).toEqual([0])
    stdin.end()
    expect(exits).toEqual([0])
  })

  it('renders the selected SDK profile name in help', () => {
    const { out } = start(['--help'], { profile: 'sdk-minimal' })
    expect(out()).toContain('Usage: dsh --profile sdk-minimal')
    expect(out()).toContain('dsh --profile sdk-minimal')
  })
})
