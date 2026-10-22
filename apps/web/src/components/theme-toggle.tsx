"use client"

import { Moon, Sun, SunMoon } from '@/lib/icons'
import { useText } from '@/lib/i18n'
import { useTheme, type Theme } from '@/lib/theme'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'

export function ThemeToggle() {
  const { theme, setTheme } = useTheme(), tx = useText()
  const options = [
    { value: 'light', label: tx('theme.light'), Icon: Sun },
    { value: 'dark', label: tx('theme.dark'), Icon: Moon },
    { value: 'system', label: tx('theme.system'), Icon: SunMoon },
  ] as const
  const current = options.find(option => option.value === theme)!
  return <Select value={theme} onValueChange={value => { if (value) setTheme(value as Theme) }}>
    <SelectTrigger showChevron={false} aria-label={`${tx('theme.label')} · ${current.label}`} className="size-8 justify-center border-0 bg-transparent p-0"><current.Icon className="size-4 text-foreground" /></SelectTrigger>
    <SelectContent>{options.map(({ value, label, Icon }) => <SelectItem key={value} value={value}><span className="inline-flex items-center gap-2"><Icon className="size-4" />{label}</span></SelectItem>)}</SelectContent>
  </Select>
}
