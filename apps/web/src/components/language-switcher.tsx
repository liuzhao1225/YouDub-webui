"use client"

import { LANGUAGE_OPTIONS, type UiLanguage, useI18n } from "@/lib/i18n"
import { Segmented } from "@/components/ui/segmented"
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select"

export function LanguageSwitcher({
  className,
  size = "sm",
  onChange,
}: {
  className?: string
  size?: "sm" | "default"
  onChange?: (language: UiLanguage) => void
}) {
  const { language, setLanguage, t } = useI18n()
  return (
    <Segmented
      ariaLabel={t.nav.language}
      value={language}
      onChange={onChange ?? setLanguage}
      size={size}
      className={className}
      options={LANGUAGE_OPTIONS.map((option) => ({
        value: option.value,
        label: size === "sm" ? option.short : option.label,
        ariaLabel: option.label,
      }))}
    />
  )
}

export function LanguageMenuButton() {
  const { language, setLanguage, t } = useI18n()
  const current = LANGUAGE_OPTIONS.find((option) => option.value === language)!
  return <Select value={language} onValueChange={(next) => { if (next) setLanguage(next as UiLanguage) }}>
    <SelectTrigger aria-label={`${t.nav.language}: ${current.label}`} title={t.nav.language}
      className="size-8 justify-center gap-0 rounded-md border-transparent bg-transparent p-0 text-xs font-semibold text-muted-foreground shadow-none hover:bg-accent [&_svg]:hidden">
      {current.short}
    </SelectTrigger>
    <SelectContent className="min-w-36">{LANGUAGE_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
  </Select>
}
