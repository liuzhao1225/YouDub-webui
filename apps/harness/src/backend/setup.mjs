import { homedir, release } from 'node:os';
import { AppError } from '../../../../packages/sdk/src/index.ts';
import { EnvironmentSetup } from '../../../../packages/builtin/src/setup-environment.ts';
import { DownloadClient } from '../../../../packages/builtin/src/setup-download.ts';
import { readJson } from './transport.mjs';
import { resourceEntries } from '../../../../packages/sdk/src/resource-state.ts';
import modelManifest from '../../../../packages/builtin/src/setup-models.json' with { type: 'json' };

// The resource service resolves model providers, their dependencies and files.
// First run includes every model in the source manifest and shared media tools.
export const firstRunBaseResources = [{ providerId: 'youdub.media' }, { providerId: 'youdub.download' }];
const selectionOf = ({ providerId, model }) => ({ providerId, ...(model ? { model } : {}) });
const sameSelection = (left, right) => left.providerId === right.providerId && left.model === right.model;

// Keep the original environment installer and setup screen contract. Harness
// owns admission, the jobs, subprocesses and the lifecycle of the domain plugins.
export function registerSetupRoutes(ctx, transport, config, activate, installation) {
  const client = new DownloadClient();
  let controller, environment, preparing, phase = 'environment', failure, bootAttempted = false, domain, finishing;
  let configuring = false;
  if (installation?.required) phase = 'installation';
  let selectionRequired = false, selected, selecting = false, checkedResources;
  const initialModels = modelManifest.map(model => ({ id: model.id, name: model.name, variant: model.variant, purpose: model.purpose, status: 'pending', received: 0, total: model.files.reduce((sum, file) => sum + file.size, 0), speed: 0 }));
  const modelItems = inventory => inventory.items.filter(item => item.automatic && modelManifest.some(model => model.id === item.downloadId));
  const allSelections = inventory => {
    const items = modelItems(inventory);
    if (modelManifest.some(model => !items.some(item => item.downloadId === model.id))) throw new AppError('MODEL_UNAVAILABLE', '首次初始化的四项模型服务未完整注册。', 422);
    return domain.resources.catalogSelections([...firstRunBaseResources, ...items.map(selectionOf)]);
  };
  const fullyReady = resources => resources?.status === 'ready' &&
    resources.environment.every(step => step.status === 'ready') && selected.every(selection => resources.requirements.some(item => sameSelection(selection, item) && item.ready)) &&
    selected.every(selection => resources.selections.some(item => sameSelection(selection, item))) &&
    modelManifest.every(model => resources.models.some(item => item.id === model.id && item.status === 'ready'));
  const validateSelections = (value, inventory) => {
    const selections = domain.resources.catalogSelections(value), required = allSelections(inventory);
    if (modelItems(inventory).some(item => !selections.some(selection => sameSelection(selection, item))) ||
        selections.some(selection => !required.some(item => sameSelection(selection, item)))) {
      throw new AppError('INVALID_INPUT', '首次初始化需要准备全部四项模型及其运行依赖。', 422);
    }
    return required;
  };
  ctx.effect(() => ctx.jobs.attachController('youdub-environment'));
  ctx.on('desktop/active-tasks', async () => {
    if (preparing || finishing || selecting || configuring) return true;
    if (domain) return domain.inspectTasks();
    if (bootAttempted) throw new AppError('TASK_RUNTIME_UNAVAILABLE', failure || 'YouDub domain activation did not finish.', 503);
    return false;
  });
  const saveSelection = resourcesPrepared => domain.settings.patch({ plugin: { id: 'youdub.onboarding', config: { resourceSelections: selected, resourcesPrepared } } });
  const finish = () => finishing ??= (async () => {
    await saveSelection(true);
    domain.start(); phase = 'ready'; failure = undefined;
  })().catch(error => { phase = 'failed'; failure = error.message; ctx.logger.error(error); }).finally(() => { finishing = undefined; });
  const snapshot = async () => {
    const inventory = domain && await domain.resources.resourceInventory();
    let resources = inventory?.resources ?? checkedResources;
    if (resources && !selectionRequired && phase !== 'ready' && phase !== 'failed') {
      if (fullyReady(resources)) await finish();
      else if (resources.status === 'ready') {
        phase = 'failed'; failure = '首次初始化的四项模型或运行依赖尚未全部就绪。';
      }
      else if (resources.status === 'failed') {
        failure = resources.error;
        phase = resources.models.some(model => model.status === 'failed') ? 'models' : 'failed';
      } else phase = resources.environment.every(step => step.status === 'ready') ? 'models' : 'environment';
    }
    const steps = (resources?.environment ?? environment?.steps ?? []).map(step => {
      const bootstrap = environment?.steps.find(initial => initial.id === step.id)?.log;
      const log = [...new Set([bootstrap, step.log].filter(Boolean))].join('\n');
      return log ? { ...step, log } : step;
    });
    if (resources) resources = { ...resources, environment: steps };
    const items = inventory ? modelItems(inventory) : [];
    return { phase, version: config.version, platform: process.platform, arch: process.arch,
      osVersion: release(), homeDir: homedir(), environment: steps,
      models: resources?.models ?? initialModels.map(model => inventory?.models.find(item => item.id === model.id) ?? model), ...(resources ? { resources } : {}),
      resourceSelection: { required: selectionRequired, selections: selected ?? items.map(selectionOf), items, prepared: phase === 'ready' },
      ...(installation ? { installation: { required: phase === 'installation', path: config.root } } : {}),
      entries: resources?.entries ?? resourceEntries({ status: phase === 'environment' ? 'preparing' : phase, environment: environment?.steps ?? [] }),
      error: failure, canRetry: Boolean(domain) || !bootAttempted };
  };
  const prepare = () => {
    if (preparing) return;
    controller = new AbortController();
    phase = 'environment'; failure = undefined;
    let execution;
    ctx.jobs.start({ label: '准备 YouDub 运行环境', run() {
      execution = (async () => {
        // The installation page is available before a worker can know its paths.
        // Resolve the declared dependency only after that choice is committed.
        await ctx.inject(['youdubWorker'], scope => {
          environment = new EnvironmentSetup(scope, config, client, controller.signal);
        });
        await environment.prepare(['base']);
        phase = 'starting';
        await environment.probe('verify');
        controller.signal.throwIfAborted();
        bootAttempted = true;
        domain = await activate();
        controller.signal.throwIfAborted();
        const onboarding = (await domain.settings.read()).plugins?.['youdub.onboarding'];
        selected = allSelections(await domain.resources.resourceInventory());
        checkedResources = await domain.resources.checkResources(selected);
        if (onboarding?.resourcesPrepared === true && fullyReady(checkedResources)) {
          await finish();
        } else {
          phase = 'models'; selectionRequired = true;
        }
      })();
      return { cancel(reason) { controller.abort(new Error(reason || 'Environment preparation cancelled')); },
        done: execution.then(() => ({ status: 'completed' }), error => ({ status: controller.signal.aborted ? 'killed' : 'failed', detail: error.message })) };
    } });
    preparing = execution.catch(error => {
      phase = 'failed'; failure = error.message; ctx.logger.error(error);
    }).finally(() => { preparing = undefined; });
  };
  ctx.effect(() => transport.register('GET', '/api/setup', async request => transport.json(request, 200, await snapshot())));
  ctx.effect(() => transport.register('POST', '/api/setup', async request => {
    const { action, id, selections, path } = await readJson(request);
    if (action === 'configure') {
      if (phase !== 'installation' || configuring) throw new AppError('SETUP_BUSY', '安装目录已经确认。', 409);
      configuring = true;
      try {
        Object.assign(config, await installation.configure(path));
        prepare();
      } finally { configuring = false; }
    } else if (phase === 'installation') {
      throw new AppError('INSTALLATION_REQUIRED', '请先选择语言和安装目录。', 409);
    } else if (action === 'prepare') {
      if (!domain || !selectionRequired || selecting) throw new AppError('SETUP_BUSY', '当前不能开始模型准备。', 409);
      selecting = true;
      try {
        selected = validateSelections(selections, await domain.resources.resourceInventory());
        await saveSelection(false);
        await domain.resources.prepareResources(selected);
        selectionRequired = false; phase = 'models'; failure = undefined;
      } catch (error) { failure = error.message; throw error; }
      finally { selecting = false; }
    } else {
      if (!['pause', 'resume', 'retry'].includes(action) || id !== undefined && !initialModels.some(model => model.id === id)) throw new AppError('INVALID_INPUT', '无效的环境准备操作或模型。', 422);
      if (domain) {
        if (phase === 'ready') throw new AppError('SETUP_FINISHED', '首次环境准备已完成。', 409);
        if (selectionRequired) throw new AppError('MODEL_SELECTION_REQUIRED', '请先开始准备全部模型。', 409);
        await domain.resources.resourceAction(action, id);
        phase = 'models'; failure = undefined;
      } else {
        if (action !== 'retry' || id !== undefined || phase !== 'failed') throw new AppError('SETUP_BUSY', '当前环境准备尚未失败。', 409);
        if (bootAttempted) throw new AppError('RESTART_REQUIRED', '工作台启动失败，请查看错误后重启应用。', 409);
        prepare();
      }
    }
    transport.json(request, 200, await snapshot());
  }));
  ctx.effect(() => async () => {
    controller?.abort(new Error('Application is stopping'));
    await preparing; await finishing;
    await client.close();
  });
  transport.assertReady = path => {
    if (path !== '/api/setup' && phase !== 'ready') throw new AppError('ENVIRONMENT_NOT_READY', failure || 'YouDub 运行环境正在准备。', 503, { phase });
  };
  if (phase !== 'installation') prepare();
}
