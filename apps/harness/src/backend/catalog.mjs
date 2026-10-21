import Catalog from '../../../../packages/builtin/src/catalog.ts';
// The domain registry describes video operations. Harness Jobs owns every live
// execution; the persisted YouDub graph decides which node is eligible to run.
export default class YouDubCatalog extends Catalog {
  static inject = ['jobs'];
  constructor(ctx) { super(ctx); ctx.effect(() => ctx.jobs.attachController('youdub-workflows')); }
  registerProvider(provider) {
    const execute = (method, args, context) => {
      const controller = new AbortController(), signal = AbortSignal.any([context.signal, controller.signal]);
      let result;
      this.ctx.jobs.start({ kind: 'youdub-operation', label: provider.describe().label || provider.id, run(job) {
        const operationContext = { ...context, signal, progress: async (value, message) => {
          await context.progress(value, message); job.updateProgress(message || (value === null ? '' : `${Math.round(value * 100)}%`));
        } };
        result = Promise.resolve().then(() => method(args, operationContext));
        return { cancel(reason) { controller.abort(new Error(reason || 'YouDub operation cancelled')); }, done: result.then(
          value => ({ status: 'completed', detail: value.state === 'waiting' ? '远端任务等待下一次检查' : undefined }),
          cause => ({ status: signal.aborted ? 'killed' : 'failed', detail: `${cause.code ?? 'OPERATION_FAILED'}: ${cause.message}` }),
        ) };
      } });
      return result;
    };
    return super.registerProvider({ ...provider, execute: (request, context) => execute(provider.execute.bind(provider), request, context),
      ...(provider.poll ? { poll: (operation, context) => execute(provider.poll.bind(provider), operation, context) } : {}) });
  }
}
