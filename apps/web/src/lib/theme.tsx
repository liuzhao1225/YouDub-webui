"use client"

import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from "react"

export type Theme = "dark" | "light"

const STORAGE_KEY = "youdub-theme"

// 在首帧绘制前应用主题，避免刷新时闪烁；默认深色。
export const THEME_INIT_SCRIPT = `(function(){try{var d=localStorage.getItem("${STORAGE_KEY}")!=="light";var e=document.documentElement;e.classList.toggle("dark",d);e.style.colorScheme=d?"dark":"light"}catch(_){}})()`

type ThemeContextValue = {
  theme: Theme
  setTheme: (theme: Theme) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

function applyTheme(theme: Theme) {
  const root = document.documentElement
  root.classList.toggle("dark", theme === "dark")
  root.style.colorScheme = theme
}

export function restoreTheme() {
  applyTheme(window.localStorage.getItem(STORAGE_KEY) === "light" ? "light" : "dark")
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("dark")

  useEffect(() => {
    const current: Theme = document.documentElement.classList.contains("dark") ? "dark" : "light"
    window.setTimeout(() => setThemeState(current), 0)
  }, [])

  const value = useMemo<ThemeContextValue>(() => ({
    theme,
    setTheme: (next) => {
      setThemeState(next)
      applyTheme(next)
      try {
        window.localStorage.setItem(STORAGE_KEY, next)
      } catch {
        // 无痕模式等场景下存储不可用，仅在当前页面生效。
      }
    },
  }), [theme])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) throw new Error("useTheme must be used inside ThemeProvider")
  return context
}
