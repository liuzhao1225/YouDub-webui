/** Theme controls read and write the persisted Harness theme preference. */
import React, { createContext, useContext, useState, useSyncExternalStore } from 'react'
import { Button, Menu, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { IconMoon, IconSun, IconSunMoon } from '@tabler/icons-react'
import { useText } from './i18n'
const Theme = createContext<any>(null)
export function ThemeProvider({source,children}:any) {
  const state=useSyncExternalStore(source.subscribe,source.getSnapshot)
  return <Theme.Provider value={{theme:state.preference,setTheme:source.setTheme}}>{children}</Theme.Provider>
}
export function useTheme(){const value=useContext(Theme);if(!value)throw new Error('YouDub theme provider is required');return value}

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const tx = useText()
  const [open, setOpen] = useState(false)
  const items = [
    { id: 'light', label: tx('client.theme.light'), icon: <IconSun size={16} aria-hidden="true" /> },
    { id: 'dark', label: tx('client.theme.dark'), icon: <IconMoon size={16} aria-hidden="true" /> },
    { id: 'system', label: tx('client.theme.system'), icon: <IconSunMoon size={16} aria-hidden="true" /> },
  ]
  const label = tx('client.theme.control', { current: items.find(item => item.id === theme)?.label ?? theme })
  const Icon = theme === 'system' ? IconSunMoon : theme === 'light' ? IconSun : IconMoon
  return <Menu open={open} portal autoFocus side="top" selectedId={theme} items={items} onClose={() => setOpen(false)} onSelect={value => { setTheme(value); setOpen(false) }} anchor={<Tooltip label={label} portal disabled={open}><Button className="yd-icon-button" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true) } }}><Icon size={16} aria-hidden="true" /></Button></Tooltip>} />
}
