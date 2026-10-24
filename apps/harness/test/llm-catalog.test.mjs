import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import LlmRuntime from '@deepseek-ai/dsh-llm';
import * as PiAi from '@deepseek-ai/dsh-llm-pi-ai';
import { register } from 'tsx/esm/api';

const source = register({ namespace: 'llm-catalog' });
const { MIN_OUTPUT_TOKENS, modelPolicy, registerModels } = await source.import('../src/backend/llm.mjs', import.meta.url);
after(() => source.unregister());

test('a credential-only built-in provider becomes available to first-run setup', async () => {
  const ctx = new Context();
  const runtime = ctx.plugin(LlmRuntime); await runtime;
  const profile = { apiKeyEnv: 'YOUDUB_CATALOG_TEST' };
  const forms = { describe: () => [{ ns: 'llm-pi-ai', value: { providers: { deepseek: profile } } }], configure: () => () => {} };
  const providers = new Map();
  let credentialPresent = true;
  const services = ctx.plugin({ name: 'catalog-fixture', apply(child) {
    child.reflect.provide('settings', forms);
    child.reflect.provide('credentials', {
      resolve: async () => credentialPresent ? { value: 'local-fixture-only', source: 'process' } : undefined,
      describe: async () => ({ configured: credentialPresent }),
    });
    child.reflect.provide('catalog', {
      registerProvider(provider) { providers.set(provider.id, provider); return () => providers.delete(provider.id); },
      provider: id => providers.get(id),
    });
  } }); await services;
  const adapter = ctx.plugin(PiAi, { providers: { deepseek: profile } }); await adapter;
  try {
    await registerModels(ctx, forms);
    const provider = providers.get('llm.deepseek');
    const description = provider.describe();
    assert.equal(description.available, true);
    assert(description.models.some(model => model.available));
    const official = PiAi.resolveProfiles({ deepseek: profile }).get('deepseek').piProvider.getModels();
    for (const model of official) {
      assert.equal(modelPolicy(ctx.llm, forms, 'deepseek', model.id).maxTokens, model.maxTokens);
      assert.equal(description.models.find(item => item.id === model.id).available, model.maxTokens >= MIN_OUTPUT_TOKENS);
    }
    assert.deepEqual(profile, { apiKeyEnv: 'YOUDUB_CATALOG_TEST' });
    credentialPresent = false;
    await provider.probe();
    assert.equal(provider.describe().available, false);
    assert.match(provider.describe().unavailableReason, /凭据/);
  } finally {
    await adapter.dispose(); await services.dispose(); await runtime.dispose();
  }
});

test('model policy follows official catalog overrides and rejects omitted output limits', () => {
  let profile = {};
  const llm = { listConfigurableProviders: () => [{ provider: 'deepseek', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'deepseek'] }] };
  const forms = { describe: () => [{ ns: 'llm-pi-ai', value: { providers: { deepseek: profile } } }] };
  const model = PiAi.resolveProfiles({ deepseek: {} }).get('deepseek').piProvider.getModels()[0].id;
  profile = { modelOverrides: { [model]: { maxTokens: 32768 } } };
  assert.equal(modelPolicy(llm, forms, 'deepseek', model).maxTokens, 32768);
  profile = { models: [{ id: model, maxTokens: 65535 }] };
  assert.equal(modelPolicy(llm, forms, 'deepseek', model).maxTokens, 65535);
  profile = { compat: { maxTokensField: 'omit' } };
  assert.throws(() => modelPolicy(llm, forms, 'deepseek', model), { code: 'OUTPUT_LIMIT_UNSUPPORTED' });
  profile = { modelOverrides: { [model]: { compat: { maxTokensField: 'omit' } } } };
  assert.throws(() => modelPolicy(llm, forms, 'deepseek', model), { code: 'OUTPUT_LIMIT_UNSUPPORTED' });
});
