import { Service, type Context } from 'cordis'
export default class Secrets extends Service {
  static inject = ['store']
  constructor(ctx: Context) { super(ctx, 'secrets') }
  async get(reference: string): Promise<string | null> {
    const value = await this.ctx.store.call('secrets.get', { reference })
    return typeof value === 'string' ? value : value?.value ?? null
  }
  async set(reference: string, value: string) { await this.ctx.store.call('secrets.set', { reference, value }) }
  async delete(reference: string) { await this.ctx.store.call('secrets.delete', { reference }) }
}
