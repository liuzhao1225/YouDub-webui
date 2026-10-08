import { Service, type Context } from 'cordis'
import type { StoreService, JsonObject } from '@youdub/sdk'
import path from 'node:path'

export default class Store extends Service implements StoreService {
  static inject = ['process']
  root: string
  private bridge!: Awaited<ReturnType<Context['process']['rpc']>>
  constructor(ctx: Context, private config: { root: string; repoRoot: string; python: string }) { super(ctx, 'store'); this.root = path.resolve(config.root) }
  async *[Service.init]() {
    this.bridge = await this.ctx.process.rpc({ command: this.config.python, args: ['-m', 'backend.workers.bridge', '--data-dir', this.root], cwd: this.config.repoRoot })
    yield () => this.bridge.close()
    await this.bridge.call('store.list', { limit: 1, offset: 0 })
  }
  call<T = any>(method: string, params: JsonObject = {}) { return this.bridge.call<T>(method, params) }
}
