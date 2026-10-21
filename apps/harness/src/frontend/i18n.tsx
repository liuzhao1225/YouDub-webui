/** Business copy follows Harness locale; no second preference store. */
import React, { createContext, useCallback, useContext, useSyncExternalStore } from 'react'
import { messages, type UiLanguage } from '../../../web/src/lib/i18n'
export type { UiLanguage } from '../../../web/src/lib/i18n'
export { LANGUAGE_OPTIONS } from '../../../web/src/lib/i18n'
const Locale = createContext<any>(null)
export function LanguageProvider({ source, children }: any) {
  const snapshot = useSyncExternalStore(source.subscribe, source.getSnapshot)
  const language:UiLanguage = snapshot.active.startsWith('zh') ? 'zh' : snapshot.active.startsWith('ja') ? 'ja' : 'en'
  return <Locale.Provider value={{ language, setLanguage:source.setLanguage, t:messages[language] }}>{children}</Locale.Provider>
}
export function useI18n() { const value = useContext(Locale); if (!value) throw new Error('Harness locale provider is required'); return value }
export function useText() { const { language } = useI18n(); return useCallback((en:string,zh:string,ja:string) => language === 'zh' ? zh : language === 'ja' ? ja : en,[language]) }
export type Text = ReturnType<typeof useText>
