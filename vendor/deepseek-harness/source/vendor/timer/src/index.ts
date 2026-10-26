import { Context, Service } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context extends Pick<TimerService, 'debounce'> {
    timer: TimerService
  }
}

/** Debounced work is cancelled with the owning Cordis fiber. */
export class TimerService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'timer')
    ctx.mixin('timer', ['debounce'])
  }

  debounce<F extends (...args: any[]) => void>(callback: F, delay: number): F & { dispose: () => void } {
    let timer: ReturnType<typeof setTimeout> | undefined
    let disposed = false
    const dispose = this.ctx.effect(() => () => {
      disposed = true
      clearTimeout(timer)
    }, 'ctx.debounce()')
    return Object.assign(((...args: Parameters<F>) => {
      clearTimeout(timer)
      if (!disposed) timer = setTimeout(callback, delay, ...args)
    }) as F, { dispose })
  }
}

export default TimerService
