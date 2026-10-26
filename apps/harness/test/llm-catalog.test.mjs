import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import LlmRuntime from '@deepseek-ai/dsh-llm';
import * as PiAi from '@deepseek-ai/dsh-llm-pi-ai';
import { register } from 'tsx/esm/api';

const source = register({ namespace: 'llm-catalog' });
const { registerModels } = await source.import('../src/backend/llm.mjs', import.meta.url);
after(() => source.unregister());

for (const [name, modelSettings, route = 'deepseek'] of [
  ['a credential-only built-in provider', {}],
  ['DeepSeek with both manually configured models and no API protocol', {
    models: ['deepseek-flash', 'deepseek-v4-pro'].map(id => ({ id, contextWindow: 8192, maxTokens: 2048 })),
  }],
  ['a provider whose official adapter omits the output limit', {
    api: 'openai-responses',
    models: [{ id: 'deepseek-flash', contextWindow: 8192, maxTokens: 2048 }],
    compat: { supportsMaxOutputTokens: false },
  }],
  ['a custom Anthropic Messages gateway with an arbitrary model ID', {
    api: 'anthropic-messages', baseURL: 'https://gateway.invalid',
    models: [{ id: 'gpt-5.6-sol', contextWindow: 8192, maxTokens: 2048 }],
  }, 'molifang'],
]) test(`${name} becomes available to first-run setup`, async () => {
  const ctx = new Context();
  const runtime = ctx.plugin(LlmRuntime); await runtime;
  const profile = { apiKeyEnv: 'YOUDUB_CATALOG_TEST', ...modelSettings };
  const savedProfile = structuredClone(profile);
  const forms = { describe: () => [{ ns: 'llm-pi-ai', value: { providers: { [route]: profile } } }], configure: () => () => {} };
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
  const adapter = ctx.plugin(PiAi, { providers: { [route]: profile } }); await adapter;
  try {
    await registerModels(ctx, forms);
    const provider = providers.get(`llm.${route}`);
    const description = provider.describe();
    assert.equal(description.available, true);
    assert(description.models.some(model => model.available));
    const official = await ctx.llm.listModels(route);
    assert.equal(Object.hasOwn(profile, 'api'), Object.hasOwn(modelSettings, 'api'));
    assert.deepEqual(description.models.map(model => model.id), official.map(model => model.id));
    for (const model of official) {
      assert.equal(description.models.find(item => item.id === model.id).available, true);
    }
    assert.deepEqual(profile, savedProfile);
    credentialPresent = false;
    await provider.probe();
    assert.equal(provider.describe().available, false);
    assert.match(provider.describe().unavailableReason, /凭据/);
  } finally {
    await adapter.dispose(); await services.dispose(); await runtime.dispose();
  }
});
