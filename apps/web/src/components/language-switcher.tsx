"use client"

import { LANGUAGE_OPTIONS, type UiLanguage, useI18n } from "@/lib/i18n"
import { Segmented } from "@/components/ui/segmented"

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
