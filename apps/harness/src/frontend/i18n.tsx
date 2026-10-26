/** All product copy and preferences use the official Harness locale service. */
import React, { createContext, useContext, useMemo, useSyncExternalStore } from 'react'
import { sharedMessages, type Text, type UiLanguage } from '../../../web/src/locales'
export { LANGUAGE_OPTIONS, type UiLanguage, type Text } from '../../../web/src/locales'
interface Source {
  getSnapshot: () => { active: string; revision: number }
  subscribe: (listener: () => void) => () => void
  setLanguage: (language: string) => void
  text: Text
}
const Locale = createContext<{
  language: UiLanguage; setLanguage: Source['setLanguage']; t: ReturnType<typeof sharedMessages>; text: Text
} | null>(null)
export function LanguageProvider({ source, children }: { source: Source; children: React.ReactNode }) {
  const snapshot = useSyncExternalStore(source.subscribe, source.getSnapshot)
  const value = useMemo(() => ({ language: snapshot.active, setLanguage: source.setLanguage, t: sharedMessages(source.text), text: source.text }), [snapshot, source])
  return <Locale.Provider value={value}>{children}</Locale.Provider>
}
export function useI18n() { const value = useContext(Locale); if (!value) throw new Error('YouDub locale provider is required'); return value }
// A new locale revision must also invalidate callbacks which captured text.
export function useText(): Text {
  const { text, language, t } = useI18n()
  return useMemo(() => (key, params) => text(key, params), [text, language, t])
}
