import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import vm from 'node:vm'
import { build } from 'esbuild'
import { checkLocales, sourceDictionary, validateDictionary } from '../check-locales.mjs'
const root = fileURLToPath(new URL('../../..', import.meta.url))
const require = createRequire(new URL('../package.json', import.meta.url))
const official = await readFile(resolve(root, '.cache/harness/source-build/packages/client/locale/lib/client.js'), 'utf8')
let LocaleRuntime
// Execute the actual official service bundle. UI atoms are unused by registry tests.
vm.runInNewContext(official, { navigator: { languages: ['en'], language: 'en' }, window: { __ModuleLoader__: { load({ factory }) {
  LocaleRuntime = factory(name => name.startsWith('react') ? require(name) : {}).LocaleRuntime
} } } })
const output = await build({ entryPoints: [resolve(root, 'apps/harness/src/frontend/locales.ts')], bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent' })
const { applyLocales, registerLanguagePack } = await import('data:text/javascript;base64,' + Buffer.from(output.outputFiles[0].text).toString('base64'))
function fixture(preference) {
  const disposers = [], writes = [], listeners = new Set()
  let value = { preference }
  const host = { getSnapshot: () => ({ value }), subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener) }, set: async (key, next) => { writes.push([key, next]); value = { ...value, [key]: next }; listeners.forEach(fn => fn()) } }
  const ctx = { emit() {}, effect(fn) { const dispose = fn(); disposers.push(dispose); return dispose } }
  ctx.locale = new LocaleRuntime(ctx, host)
  return { ctx, writes, dispose: () => disposers.reverse().forEach(fn => fn?.()) }
}
test('shipped business and official dictionaries have all keys and matching parameters', async () => {
  const result = await checkLocales()
  assert.deepEqual(result.languages, ['zh', 'en', 'ja'])
  assert.ok(result.businessKeys > 500)
})
test('missing translations and damaged interpolation fail the build gate', () => {
  assert.throws(() => validateDictionary({ label: '{name}' }, {}, 'fixture'), /missing label/)
  assert.throws(() => validateDictionary({ label: '{name}' }, { label: '{value}' }, 'fixture'), /placeholder mismatch/)
})
test('official locale restores Japanese, translates settings and persists switching', () => {
  const { ctx, writes, dispose } = fixture('ja')
  try {
    applyLocales(ctx)
    assert.equal(ctx.locale.getLocale().active, 'ja')
    assert.equal(ctx.locale.bind('settings')('general.nav'), '一般')
    assert.equal(ctx.locale.bind('settings.models')('keyInput'), 'API キー')
    assert.equal(ctx.locale.bind('settings.models')('editProvider', { provider: 'Fixture' }), 'Fixture を編集')
    assert.equal(ctx.locale.bind('settings.theme')('appearance.system'), 'システム')
    assert.equal(ctx.locale.bind('youdub')('nav.newTask'), '新規タスク')
    assert.equal(writes.length, 0)
    ctx.locale.setLocale('en')
    assert.equal(ctx.locale.bind('youdub')('nav.newTask'), 'New task')
    ctx.locale.setLocale('zh')
    assert.equal(ctx.locale.bind('youdub')('nav.newTask'), '新建任务')
    ctx.locale.setLocale('ja')
    assert.deepEqual(writes, [['preference', 'en'], ['preference', 'zh'], ['preference', 'ja']])
  } finally { dispose() }
})
test('a fourth plugin language enters the official catalog and uses upstream fallback', async () => {
  const { ctx, dispose } = fixture('fr')
  try {
    ctx.locale.register('settings', 'en', await sourceDictionary('vendor/deepseek-harness/source/packages/client/ui-settings-general/src/client/locales.ts'))
    applyLocales(ctx)
    registerLanguagePack(ctx, { id: 'fr', label: 'Français', fallback: 'en', messages: { 'nav.newTask': 'Nouvelle tâche' } }, { settings: { title: 'Paramètres' } })
    assert.equal(ctx.locale.getLocale().active, 'fr')
    assert.equal(ctx.locale.getLocale().locales.length, 4)
    assert.equal(ctx.locale.bind('youdub')('nav.newTask'), 'Nouvelle tâche')
    assert.equal(ctx.locale.bind('youdub')('player.play'), 'Play')
    assert.equal(ctx.locale.bind('settings')('title'), 'Paramètres')
    assert.equal(ctx.locale.bind('settings')('general.currentVersion', { version: '1.0' }), 'Current version: 1.0')
  } finally { dispose() }
})
