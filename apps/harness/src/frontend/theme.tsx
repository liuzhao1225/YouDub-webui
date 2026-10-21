/** The original YouDub theme control reads and writes the Harness theme service. */
import React, { createContext, useContext, useSyncExternalStore } from 'react'
const Theme = createContext<any>(null)
export function ThemeProvider({source,children}:any) {
  const state=useSyncExternalStore(source.subscribe,source.getSnapshot)
  return <Theme.Provider value={{theme:state.active.colorScheme,setTheme:source.setTheme}}>{children}</Theme.Provider>
}
export function useTheme(){const value=useContext(Theme);if(!value)throw new Error('Harness theme provider is required');return value}
