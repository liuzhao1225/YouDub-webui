/** React binding over the official theme service snapshot and actions. */
import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react'
interface ThemeSource {
  getSnapshot(): { preference: string }
  subscribe(listener: () => void): () => void
  setTheme(value: string): void
}
const Theme = createContext<{ theme: string; setTheme: ThemeSource['setTheme'] } | null>(null)
export function ThemeProvider({ source, children }: { source: ThemeSource; children: ReactNode }) {
  const state = useSyncExternalStore(source.subscribe, source.getSnapshot)
  return <Theme.Provider value={{ theme: state.preference, setTheme: source.setTheme }}>{children}</Theme.Provider>
}
export function useTheme() {
  const value = useContext(Theme)
  if (!value) throw new Error('YouDub theme provider is required')
  return value
}
