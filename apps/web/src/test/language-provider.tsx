/** Locale service fixture; views render through the same provider as Desktop. */
import { useMemo, type ReactNode } from 'react'
import { LanguageProvider as HarnessLanguageProvider } from '../../../harness/src/frontend/i18n'
import { languagePacks, translateMessage, type Text } from '../locales'
function localeSource() {
    const saved = localStorage.getItem('youdub-ui-language')
    let snapshot = { active: languagePacks.find(pack => pack.id === saved)?.id ?? 'zh', revision: 0 }
    const listeners = new Set<() => void>()
    return {
      getSnapshot: () => snapshot,
      subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
      text: ((key, params) => translateMessage(snapshot.active, key, params)) as Text,
      setLanguage: (active: string) => {
        snapshot = { active, revision: snapshot.revision + 1 }
        localStorage.setItem('youdub-ui-language', active)
        listeners.forEach(listener => listener())
      },
    }
}
export function LanguageProvider({ children }: { children: ReactNode }) {
  const source = useMemo(() => localeSource(), [])
  return <HarnessLanguageProvider source={source}>{children}</HarnessLanguageProvider>
}
