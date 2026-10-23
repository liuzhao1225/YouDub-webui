import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { build } from 'esbuild'
const root = fileURLToPath(new URL('../..', import.meta.url))
const require = createRequire(resolve(root, 'package.json'))
const ts = require('typescript')

// Read the original literal dictionaries without importing UI code or editing upstream.
export async function sourceDictionary(path, name = 'en') {
  const file = ts.createSourceFile(path, await readFile(resolve(root, path), 'utf8'), ts.ScriptTarget.Latest, true)
  let value
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === name) value = node.initializer
    ts.forEachChild(node, visit)
  }
  visit(file)
  function literal(node) {
    if (ts.isSatisfiesExpression(node) || ts.isAsExpression(node)) return literal(node.expression)
    if (ts.isStringLiteralLike(node)) return node.text
    if (ts.isObjectLiteralExpression(node)) return Object.fromEntries(node.properties.map(property => [property.name.text, literal(property.initializer)]))
    throw new Error(`Unsupported dictionary expression: ${path}`)
  }
  if (!value) throw new Error(`Dictionary ${name} not found: ${path}`)
  return literal(value)
}
const placeholders = value => [...new Set([...value.matchAll(/\{(\w+)\}/g)].map(match => match[1]))].sort().join(',')
export function validateDictionary(base, translation, description, extras = []) {
  for (const [key, value] of Object.entries(base)) {
    if (typeof translation[key] !== 'string') throw new Error(`${description}: missing ${key}`)
    if (placeholders(value) !== placeholders(translation[key])) throw new Error(`${description}: placeholder mismatch at ${key}`)
  }
  for (const key of Object.keys(translation)) if (!(key in base) && !extras.includes(key)) throw new Error(`${description}: unknown ${key}`)
}
export async function checkLocales() {
  const bundle = await build({ entryPoints: [resolve(root, 'apps/harness/src/frontend/locales.ts')], bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent' })
  const { frameworkDictionaries } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'))
  const registryBundle = await build({ entryPoints: [resolve(root, 'apps/web/src/locales/index.ts')], bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent' })
  const { languagePacks } = await import('data:text/javascript;base64,' + Buffer.from(registryBundle.outputFiles[0].text).toString('base64'))
  const base = languagePacks.find(pack => pack.id === 'en').messages
  const names = new Set()
  const sources = {
    common: 'locale/src/locales/en.ts',
    'settings.locale': 'locale/src/locales/settings.ts',
    settings: 'ui-settings-general/src/client/locales.ts',
    'settings.theme': 'ui-theme/src/client/locales.ts',
    'settings.models': 'ui-settings-models/src/client/locales.ts',
    pluginManager: 'ui-plugin-manager/src/client/locales.ts',
  }
  for (const pack of languagePacks) {
    if (names.has(pack.id)) throw new Error(`Duplicate language ${pack.id}`)
    names.add(pack.id)
    validateDictionary(base, pack.messages, `YouDub ${pack.id}`)
    if (['en', 'zh'].includes(pack.id)) continue
    const dictionaries = frameworkDictionaries[pack.id]
    if (!dictionaries) throw new Error(`Missing framework language pack: ${pack.id}`)
    for (const [namespace, path] of Object.entries(sources)) {
      const original = await sourceDictionary('vendor/deepseek-harness/source/packages/client/' + path)
      validateDictionary(original, dictionaries[namespace] ?? {}, `${pack.id} ${namespace}`, namespace === 'pluginManager' ? ['youdub.bundleMissing', 'youdub.applicationVersion', 'youdub.packageVersion', 'youdub.bundled', 'youdub.builtinTitle'] : [])
    }
  }
  return { passed: true, languages: [...names], businessKeys: Object.keys(base).length, frameworkNamespaces: Object.keys(sources).length + 1 }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(JSON.stringify(await checkLocales(), null, 2))
