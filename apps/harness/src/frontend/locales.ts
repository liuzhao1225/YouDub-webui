import { languagePacks, type LanguagePack } from '../../../web/src/locales'
import japanese from '../../locales/ja.json'

export const frameworkDictionaries: Record<string, Record<string, Record<string, string>>> = { ja: japanese }

/** Public Harness language-pack API; preferences, fallback and UI are upstream-owned. */
export function registerLanguagePack(ctx: any, pack: LanguagePack, dictionaries: Record<string, Record<string, string>> = {}) {
  ctx.effect(() => ctx.locale.register('youdub', pack.id, pack.messages))
  for (const [namespace, dictionary] of Object.entries(dictionaries)) {
    ctx.effect(() => ctx.locale.register(namespace, pack.id, dictionary))
  }
  if (!ctx.locale.getLocale().locales.some((locale: { id: string }) => locale.id === pack.id)) {
    ctx.effect(() => ctx.locale.addLanguage({ id: pack.id, label: pack.label, fallback: pack.fallback ?? 'en' }))
  }
}
export function applyLocales(ctx: any) {
  for (const pack of languagePacks) registerLanguagePack(ctx, pack, frameworkDictionaries[pack.id])
}
