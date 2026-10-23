"use client"

import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react"

export type Theme = "light" | "dark" | "system"
const STORAGE_KEY = "youdub-theme"
type ThemeContextValue = { theme: Theme; setTheme: (theme: Theme) => void }
const ThemeContext = createContext<ThemeContextValue | null>(null)

function savedTheme(): Theme {
  const saved = window.localStorage.getItem(STORAGE_KEY)
  return saved === 'dark' || saved === 'system' ? saved : 'light'
}
function applyTheme(theme: Theme) {
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
  document.body.toggleAttribute('data-ds-dark-theme', dark)
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
}
export function restoreTheme() { applyTheme(savedTheme()) }

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(savedTheme)
  useEffect(() => {
    applyTheme(theme)
    if (theme !== 'system') return
    const system = window.matchMedia('(prefers-color-scheme: dark)')
    const update = () => applyTheme('system')
    system.addEventListener('change', update)
    return () => system.removeEventListener('change', update)
  }, [theme])
  const value = useMemo<ThemeContextValue>(() => ({ theme, setTheme: next => {
    window.localStorage.setItem(STORAGE_KEY, next)
    applyTheme(next)
    setThemeState(next)
  } }), [theme])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}
export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('useTheme must be used inside ThemeProvider')
  return context
}
