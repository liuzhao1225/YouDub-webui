import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import CredentialsLocal from '@deepseek-ai/dsh-credentials-local';
import { credentialRef } from '@deepseek-ai/dsh-credentials';
import { readCredentialPreview, registerCredentialPreview } from '../src/backend/credential-preview.mjs';

const ref = credentialRef('YOUDUB_PREVIEW_FIXTURE');
const directory = [{ provider: 'fixture', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'fixture'] }];
const services = credentials => ({
  credentials, llm: { listConfigurableProviders: () => directory },
  settings: { describe: () => [{ ns: 'llm-pi-ai', value: { providers: { fixture: { apiKeyEnv: ref } } } }] },
});

test('saved official credentials reopen as six characters and three stars without returning the secret', async () => {
  const path = await mkdtemp(join(tmpdir(), 'youdub-key-preview-'));
  const secret = 'abcdef-fixture-only-complete-secret';
  let runtime;
  try {
    const first = new Context(); runtime = first.plugin(CredentialsLocal, { path: join(path, 'credentials.yml'), watch: false }); await runtime;
    await first.credentials.set(ref, secret);
    const firstView = await readCredentialPreview(services(first.credentials), 'fixture');
    assert.deepEqual(firstView, { preview: 'abcdef***' });
    assert.equal(JSON.stringify(firstView).includes(secret), false);
    await runtime.dispose();
    const reopened = new Context(); runtime = reopened.plugin(CredentialsLocal, { path: join(path, 'credentials.yml'), watch: false }); await runtime;
    assert.deepEqual(await readCredentialPreview(services(reopened.credentials), 'fixture'), firstView);
    await reopened.credentials.set(ref, 'uvwxyz-replacement-fixture-only');
    assert.deepEqual(await readCredentialPreview(services(reopened.credentials), 'fixture'), { preview: 'uvwxyz***' });
    await reopened.credentials.set(ref, 'short');
    assert.deepEqual(await readCredentialPreview(services(reopened.credentials), 'fixture'), { preview: '***' });
    await reopened.credentials.unset(ref);
    assert.deepEqual(await readCredentialPreview(services(reopened.credentials), 'fixture'), { preview: null });
  } finally { await runtime?.dispose(); await rm(path, { recursive: true, force: true }); }
});

test('preview route accepts provider identities only and never exposes the full credential in its response', async () => {
  const calls = [], secret = '123456-fixture-never-sent-to-browser';
  let route;
  const ctx = { ...services({ resolve: async value => { calls.push(value); return { value: secret, source: 'file' }; } }),
    effect: action => action(), connection: { fetch: { register(value) { route = value; return () => {}; } } },
  };
  registerCredentialPreview(ctx);
  assert.deepEqual(route.methods, ['GET']);
  const response = await route.fetch(new Request('http://localhost/api/youdub/credential-preview?provider=fixture'));
  const body = await response.text();
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(JSON.parse(body), { preview: '123456***' }); assert.equal(body.includes(secret), false);
  assert.deepEqual(calls, [ref]);
  const unknown = await route.fetch(new Request('http://localhost/api/youdub/credential-preview?provider=OTHER_SECRET_REF'));
  assert.equal(unknown.status, 404); assert.deepEqual(calls, [ref]);
  const original = new Error('official credential store unavailable');
  ctx.credentials.resolve = async () => { throw original; };
  await assert.rejects(readCredentialPreview(ctx, 'fixture'), error => error === original);
  const failure = await route.fetch(new Request('http://localhost/api/youdub/credential-preview?provider=fixture'));
  assert.equal(failure.status, 500); assert.equal((await failure.json()).error.message, original.message);
});
