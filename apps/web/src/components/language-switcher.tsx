"use client"

import { LANGUAGE_OPTIONS, type UiLanguage, useI18n } from "@/lib/i18n"
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select"

/** Standalone web settings; Harness uses its unchanged official LanguageRow. */
export function LanguageSwitcher({ className, onChange }: { className?: string; onChange?: (language: UiLanguage) => void }) {
  const { language, setLanguage, t } = useI18n()
  return <Select value={language} onValueChange={next => { if (next) (onChange ?? setLanguage)(next) }}>
    <SelectTrigger aria-label={t.nav.language} className={className}>
      {LANGUAGE_OPTIONS.find(option => option.value === language)?.label ?? language}
    </SelectTrigger>
    <SelectContent>{LANGUAGE_OPTIONS.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
  </Select>
}
