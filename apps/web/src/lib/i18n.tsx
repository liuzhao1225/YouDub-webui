"use client"

import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react"
import { isLanguage, sharedMessages, translateMessage, type Text, type UiLanguage } from '../locales'
export { LANGUAGE_OPTIONS, type UiLanguage, type Text } from '../locales'

const STORAGE_KEY = "youdub-ui-language"
const LanguageContext = createContext<{
  language: UiLanguage
  setLanguage: (language: UiLanguage) => void
  t: ReturnType<typeof sharedMessages>
  text: Text
} | null>(null)

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<UiLanguage>("zh")
  const setLanguage = useCallback((next: UiLanguage) => {
    setLanguageState(next)
    window.localStorage.setItem(STORAGE_KEY, next)
  }, [])
  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY)
    if (isLanguage(saved)) window.setTimeout(() => setLanguageState(saved), 0)
  }, [])
  useEffect(() => { document.documentElement.lang = language === "zh" ? "zh-CN" : language }, [language])
  const text = useCallback<Text>((key, params) => translateMessage(language, key, params), [language])
  const value = useMemo(() => ({ language, setLanguage, text, t: sharedMessages(text) }), [language, setLanguage, text])
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}

export function useI18n() {
  const context = useContext(LanguageContext)
  if (!context) throw new Error("useI18n must be used inside LanguageProvider")
  return context
}
export function useText() { return useI18n().text }
