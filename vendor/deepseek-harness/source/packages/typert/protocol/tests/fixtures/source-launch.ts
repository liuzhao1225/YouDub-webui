import { Context } from '@deepseek-ai/cordis'
import {
  TypertRemoteService,
  Remote,
  RemoteScope,
  remoteMethods,
  type TypertContext,
} from '@deepseek-ai/dsh-typert-protocol'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertContextMap {
    metaFixture: TypertContext<string>
  }
}

class Goals extends TypertRemoteService {
  constructor(ctx: Context) {
    super(ctx, 'goals')
  }

  @Remote
  create(value: string): string {
    return value
  }

  @RemoteScope('metaFixture')
  scoped(value: string): string {
    return value
  }
}

const methods = remoteMethods(new Goals(new Context()))
const actual = JSON.stringify(methods)
const expected = JSON.stringify([
  { method: 'create', invocation: { kind: 'direct' } },
  { method: 'scoped', invocation: { kind: 'context', context: 'metaFixture' } },
])
if (actual !== expected) throw new Error(`unexpected Remote declarations: ${actual}`)
process.stdout.write(actual)
