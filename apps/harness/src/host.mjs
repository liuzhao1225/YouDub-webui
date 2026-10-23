import { readFile, mkdir } from 'node:fs/promises';
import { delimiter, join, resolve } from 'node:path';
import { homedir, release } from 'node:os';
import { fileURLToPath } from 'node:url';
import z from '@deepseek-ai/schemastery';
import YouDubWorker from './backend/worker.mjs';
import YouDubCatalog from './backend/catalog.mjs';
import YouDubSettings from './backend/settings.mjs';
import Resources, { registerResourceRoutes } from './backend/resources.ts';
import { YouDubTransport } from './backend/transport.mjs';
import { registerTaskRoutes } from './backend/api.ts';
import { registerExtensionRoutes } from './backend/extensions.mjs';
import { registerModels } from './backend/llm.mjs';
import { registerExampleRoutes } from './backend/examples.mjs';
import { registerSetupRoutes } from './backend/setup.mjs';
import { existingInstallation, installationDirectory, privatePython } from './backend/installation.mjs';
import { hasInterruptibleTasks } from './backend/activity.mjs';
import modelManifest from '../../../packages/builtin/src/setup-models.json' with { type: 'json' };
import Store from '../../../packages/builtin/src/store.ts';
import Files from '../../../packages/builtin/src/files.ts';
import Tasks from '../../../packages/builtin/src/tasks.ts';
import * as PythonProvider from '../../../packages/builtin/src/python-provider.ts';
import * as MediaOutputValidation from '../../../packages/builtin/src/media-output-validation.ts';
import * as Localize from '../../../packages/builtin/src/workflow-localize.ts';
import * as Graph from '../../../packages/builtin/src/workflow-graph.ts';
import { builtinIntegrities } from '../../../packages/builtin/src/builtin-integrity.ts';
import { builtinResources } from '../../../packages/builtin/src/runtime-resources.ts';
import { operations } from '../../../packages/builtin/src/media-contracts.ts';

export const name = 'youdub-subtitles';
export const inject = ['connection', 'subprocess', 'jobs', 'credentials', 'llm', 'settings', 'pluginManager'];
export const Config = z.object({
  python: z.string().required(),
  modelsDir: z.string().required(),
  dataDir: z.string().required(),
  installation: z.any().default(null).volatile(),
  preferences: z.any().default({ ui_language: 'zh', defaults: null, plugins: {}, connections: [] }).volatile(),
});
const domainNames = ['catalog', 'store', 'files', 'tasks', 'settings'];

// Extension authors use their own official Loader context to join the domain.
// The extension lifecycle and service dependency ownership stay in Harness.
export function youdubContext(ctx) {
  return domainNames.reduce((child, key) => child.isolate(key, ctx.youdubDomain.labels[key]), ctx);
}
export function registerPythonProvider(ctx, config) {
  return youdubContext(ctx).plugin({ name: 'youdub-python-extension', inject: [...PythonProvider.inject, ...(config.runtimeAdapter ? ['store'] : [])], apply: child => PythonProvider.apply(child, config) });
}
export async function apply(ctx, config) {
  const skipSetup = process.env.YOUDUB_TEST_SKIP_SETUP === '1';
  if (skipSetup) ctx.on('webserver/index-inject', table => { table.push({ kind: 'global', name: '__YOUDUB_TEST_SKIP_SETUP__', value: true }); });
  const root = process.env.YOUDUB_MEDIA_ROOT ? resolve(process.env.YOUDUB_MEDIA_ROOT) : fileURLToPath(new URL('../../../', import.meta.url));
  const forms = ctx.settings;
  const savedInstallation = config.installation.get();
  const legacy = !savedInstallation && await existingInstallation(resolve(config.dataDir));
  let data = resolve(savedInstallation?.path ?? config.dataDir);
  let runtimeConfig = savedInstallation ? { ...config, python: privatePython(data), modelsDir: join(data, 'models/whisper') } : config;
  if (skipSetup && process.env.YOUDUB_TEST_PYTHON) runtimeConfig = { ...runtimeConfig, python: process.env.YOUDUB_TEST_PYTHON };
  const { version } = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
  ctx.on('webserver/index-inject', table => { table.push({ kind: 'global', name: '__YOUDUB_APP_INFO__', value: { version, platform: process.platform, arch: process.arch, osVersion: release() } }); });
  const labels = Object.fromEntries(domainNames.map(key => [key, Symbol(`youdub.${key}`)]));
  const domain = domainNames.reduce((child, key) => child.isolate(key, labels[key]), ctx);
  let modelRoots;
  const initialize = async () => {
    await mkdir(data, { recursive: true });
    ctx.reflect.provide('youdubDomain', { labels, python: runtimeConfig.python, dataDir: data, repoRoot: root });
    modelRoots = Object.fromEntries(modelManifest.map(model => {
      const path = model.id === 'whisper' ? runtimeConfig.modelsDir : join(data, 'models', model.directory);
      return [model.id, resolve(path.startsWith('~/') ? join(homedir(), path.slice(2)) : path)];
    }));
    const modelEnvironment = Object.fromEntries(modelManifest.map(model => [model.env, modelRoots[model.id]]));
    const mediaDirectory = join(data, 'runtime', 'ffmpeg', ...(process.platform === 'win32' ? ['ffmpeg-7.1.5-win32-x64-gpl-shared', 'bin'] : []));
    await domain.plugin(YouDubWorker, { env: {
      YOUDUB_HARNESS_RUNTIME: '1', PYTHONPATH: root, PYTHONHOME: '', PYTHONNOUSERSITE: '1', YOUDUB_DESKTOP_DATA_DIR: data,
      YOUDUB_NODE_PATH: process.env.YOUDUB_NODE_PATH || '',
      FFMPEG_PATH: join(mediaDirectory, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'),
      FFPROBE_PATH: join(mediaDirectory, process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'),
      NLTK_DATA: join(data, 'nltk_data'), HF_HOME: join(data, 'runtime', 'huggingface'),
      HF_HUB_CACHE: join(data, 'runtime', 'huggingface', 'hub'), HF_ASSETS_CACHE: join(data, 'runtime', 'huggingface', 'assets'),
      HUGGINGFACE_HUB_CACHE: join(data, 'runtime', 'huggingface', 'hub'),
      PIP_CACHE_DIR: join(data, 'runtime', 'cache', 'pip'), MODELSCOPE_CACHE: join(data, 'runtime', 'modelscope'),
      TORCH_HOME: join(data, 'runtime', 'torch'), XDG_CACHE_HOME: join(data, 'runtime', 'cache'),
      PATH: [mediaDirectory, process.env.PATH || ''].join(delimiter), ...modelEnvironment,
    } });
  };
  if (savedInstallation || legacy || skipSetup) await initialize();
  const transport = new YouDubTransport(ctx);
  transport.mount();
  registerExampleRoutes(ctx, transport, root);
  if (skipSetup) {
    const services = await activateDomain(domain, { config: runtimeConfig, root, data, forms, modelRoots, version, transport });
    ctx.effect(() => transport.register('GET', '/api/setup', request => transport.json(request, 200, { phase: 'skipped', testMode: true, version, platform: process.platform, arch: process.arch, environment: [], models: [], canRetry: false, token: '' })));
    ctx.on('desktop/active-tasks', () => services.inspectTasks());
    services.start();
    return;
  }
  await domain.plugin({ name: 'youdub-environment', inject: ['jobs'], apply(child) {
    registerSetupRoutes(child, transport, { root: data, repoRoot: root, python: runtimeConfig.python, version, privateEnvironment: true }, async () => {
      return activateDomain(domain, { config: runtimeConfig, root, data, forms, modelRoots, version, transport });
    }, {
      required: !savedInstallation && !legacy,
      path: data,
      async configure(path) {
        const chosen = await installationDirectory(path);
        const descriptor = forms.describe().find(item => item.ns === 'youdub-subtitles');
        if (!descriptor) throw new Error('YouDub installation settings are unavailable.');
        await forms.update('youdub-subtitles', { installation: { path: chosen } }, descriptor.revision);
        data = chosen;
        runtimeConfig = { ...config, python: privatePython(data), modelsDir: join(data, 'models/whisper') };
        await initialize();
        return { root: data, python: runtimeConfig.python };
      },
    });
  } });
}

async function activateDomain(domain, { config, root, data, forms, modelRoots, version, transport }) {
  await domain.plugin(YouDubCatalog);
  await domain.plugin(Store, { root: data, repoRoot: root, python: config.python });
  await domain.plugin(Files, { root: data });
  await domain.plugin(YouDubSettings, { forms, preferences: config.preferences });
  await domain.plugin(MediaOutputValidation);
  const identities = await builtinIntegrities(root);
  for (const [id, label, kinds, capability] of [
    ['youdub.download', 'yt-dlp', ['download']],
    ['youdub.media', 'FFmpeg / Media', ['prepare', 'reference', 'mix', 'export', 'importSubtitles']],
    ['whisper', 'Whisper', ['recognize'], 'asr'],
    ['voxcpm', 'VoxCPM', ['synthesize'], 'tts'],
    ['demucs', 'Demucs', ['separate'], 'separation'],
    ['qwen_forced_aligner', 'Qwen Forced Aligner', ['align'], 'subtitle_alignment'],
  ]) await domain.plugin({ name: `youdub-provider-${id}`, inject: ['catalog', 'youdubWorker', 'store'], apply: async child => { await PythonProvider.apply(child, {
    command: config.python, args: ['-m', 'backend.workers.operation'], cwd: root,
    runtimeAdapter: capability ? id : undefined, corrections: 'media',
    dependencyGroups: capability ? undefined : ['base', ...(builtinResources(id)?.dependencyGroups ?? [])],
    descriptor: { id, label, pluginId: `youdub.provider-${id}`, pluginVersion: '1.0.0', ...identities[id], resources: builtinResources(id),
      operations: kinds.map(key => operations[key]), ...(capability ? { capability, adapter: id } : {}), execution: 'local' },
  }); } });
  await domain.plugin({ name: 'youdub-harness-models', inject: ['catalog', 'llm', 'credentials'], apply: child => registerModels(child, forms) });
  await domain.plugin(Localize, identities['youdub.localize']);
  await domain.plugin(Graph, identities['youdub.graph']);
  await domain.plugin(Tasks);
  await domain.plugin(Resources, { root: data, repoRoot: root, python: config.python, modelRoots, version, privateEnvironment: true });
  let services;
  await domain.plugin({ name: 'youdub-domain-api', inject: ['connection', 'catalog', 'store', 'files', 'tasks', 'settings', 'youdubResources', 'pluginManager'], apply(child) {
    registerTaskRoutes(child, transport);
    registerResourceRoutes(child, transport);
    registerExtensionRoutes(child, transport);
    // These domain lifecycle events start and stop only the existing graph queue;
    // the enclosing plugin and every worker remain owned by the one Harness Host.
    services = { resources: child.youdubResources, settings: child.settings,
      inspectTasks: () => hasInterruptibleTasks(child.store), start: () => child.emit('app/ready') };
  } });
  return services;
}

export { AppError } from "../../../packages/sdk/src/index.ts";

export { translateWithHarness } from './backend/llm.mjs';
