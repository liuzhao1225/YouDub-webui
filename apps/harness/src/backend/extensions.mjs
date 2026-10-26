import { readJson } from './transport.mjs';

const fail = (code, message, status = 422, details) => Object.assign(new Error(message), { code, status, details });
const object = value => value && typeof value === 'object' && !Array.isArray(value);

/** Keep the domain API usable while Harness owns installation and activation. */
export function extensionSpec(input) {
  if (!object(input) || typeof input.source !== 'string' || !input.source.trim()) throw fail('INVALID_CONFIG', '请输入插件包、Git 仓库或本地绝对路径。');
  if (Object.keys(input).some(key => !['source', 'ref', 'enabled', 'config', 'requestId', 'approvedBuilds'].includes(key))) throw fail('INVALID_CONFIG', '插件安装请求包含未知字段。');
  let spec = input.source.trim().replace(/^npm:/, '');
  if (input.ref !== undefined && (typeof input.ref !== 'string' || !input.ref.trim() || /[\s#\x00-\x1f]/.test(input.ref) || input.ref.startsWith('-'))) throw fail('INVALID_CONFIG', '插件版本或 Git ref 无效。');
  if (input.ref) {
    if (!/^(?:github:|git\+|git@|https:\/\/github\.com\/)/.test(spec) || spec.includes('#')) throw fail('INVALID_CONFIG', '独立 ref 仅用于尚未指定 ref 的 Git 仓库。npm 包请使用 package@version。');
    spec += '#' + input.ref;
  }
  if (input.enabled !== undefined && typeof input.enabled !== 'boolean') throw fail('INVALID_CONFIG', 'enabled 必须为布尔值。');
  if (input.config !== undefined && (!object(input.config) || Object.keys(input.config).length)) throw fail('HARNESS_PLUGIN_CONFIG_REQUIRED', '请在安装后的插件设置中填写配置。');
  if (input.approvedBuilds !== undefined && (!Array.isArray(input.approvedBuilds) || input.approvedBuilds.some(name => typeof name !== 'string' || !name))) throw fail('INVALID_CONFIG', 'approvedBuilds 必须包含明确批准的依赖包名。');
  if (input.requestId !== undefined && (typeof input.requestId !== 'string' || !input.requestId.trim())) throw fail('INVALID_CONFIG', '安装 requestId 无效。');
  return spec;
}

/** A saved desired state is distinct from a successfully activated plugin. */
export function requireAppliedChange(result) {
  if (result.application === 'failed' || result.application === 'cancelled' || result.application === 'overridden' || result.error) {
    throw fail(result.error?.code ?? (result.application === 'cancelled' ? 'PLUGIN_INSTALL_CANCELLED' : 'PLUGIN_CHANGE_FAILED'),
      result.error?.diagnostic ?? result.packageResult?.output ?? `插件操作未生效：${result.application}`,
      result.application === 'cancelled' || result.application === 'overridden' ? 409 : 422, result);
  }
  return result;
}

export async function extensionInventory(manager) {
  const [bundles, entries] = await Promise.all([manager.listBundles(), manager.listPlugins()]);
  const entryById = new Map(entries.map(entry => [entry.entryId, entry]));
  return { framework: 'harness', bundles, entries, items: bundles.map(bundle => {
    const rows = bundle.rows.map(row => row.entryId ? entryById.get(row.entryId) : undefined);
    const active = bundle.enabled && !bundle.error && rows.length > 0 && rows.every(row => row?.fiberPhase === 'active');
    return { id: bundle.name, version: bundle.version, source: bundle.source ?? bundle.name, installed: bundle.installed,
      enabled: bundle.enabled, active,
      activation: bundle.error || rows.some(row => row?.fiberPhase === 'failed') ? 'failed' : active ? 'active' : bundle.enabled ? 'pending' : 'disabled',
      removable: bundle.removable, ...(bundle.error ? { error: bundle.error } : {}) };
  }) };
}

export function registerExtensionRoutes(ctx, http) {
  const manager = ctx.pluginManager;
  if (!manager) throw fail('HARNESS_PLUGIN_MANAGER_UNAVAILABLE', '插件管理服务未启动。', 503);
  const route = (method, path, handler) => ctx.effect(() => http.register(method, path, handler));
  route('GET', '/api/v2/extensions', async request => http.json(request, 200, await extensionInventory(manager)));
  route('POST', '/api/v2/extensions/inspect', async request => {
    const input = await readJson(request);
    http.json(request, 200, await manager.inspect(extensionSpec(input), { registry: 'https://registry.npmmirror.com' }));
  });
  route('POST', '/api/v2/extensions/install', async request => {
    const input = await readJson(request), spec = extensionSpec(input);
    const inspected = await manager.inspect(spec, { registry: 'https://registry.npmmirror.com' });
    if (inspected.status === 'refused') throw fail(inspected.problem,
      inspected.problem === 'not-a-bundle'
        ? `${inspected.reason} 请使用声明 dsh.bundle 的兼容插件包。`
        : inspected.reason, 422, inspected);
    const result = requireAppliedChange(await manager.installBundle(spec, { enabled: input.enabled ?? true, saveExact: true,
      registry: 'https://registry.npmmirror.com', ...(input.requestId ? { requestId: input.requestId } : {}),
      ...(input.approvedBuilds ? { approvedBuilds: input.approvedBuilds } : {}) }));
    http.json(request, 201, result);
  });
  route('PATCH', '/api/v2/extensions/:id', async request => {
    const input = await readJson(request);
    if (typeof input.enabled !== 'boolean') throw fail('INVALID_CONFIG', 'enabled 必须为布尔值。');
    if (input.kind !== undefined && !['entry', 'bundle'].includes(input.kind)) throw fail('INVALID_CONFIG', '插件目标必须为 entry 或 bundle。');
    const result = input.kind === 'entry'
      ? await manager.setPluginEnabled(request.params.id, input.enabled)
      : await manager.setBundleEnabled(request.params.id, input.enabled);
    http.json(request, 200, requireAppliedChange(result));
  });
  route('DELETE', '/api/v2/extensions/:id', async request => http.json(request, 200, requireAppliedChange(await manager.removeBundle(request.params.id))));
  route('POST', '/api/v2/extensions/install/:requestId/cancel', async request => http.json(request, 200, await manager.cancelInstall(request.params.requestId)));
  route('GET', '/api/v2/extensions/install/:requestId', async request => http.json(request, 200, await manager.waitForInstall(request.params.requestId)));
  route('GET', '/api/v2/client-manifest', async request => {
    const inventory = await extensionInventory(manager);
    http.json(request, 200, { framework: 'harness', loader: 'official', bundles: inventory.bundles, entries: inventory.entries });
  });
}
