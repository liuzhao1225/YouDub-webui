"use client"

import { Check } from "lucide-react"

import { LANGUAGE_OPTIONS, type UiLanguage, useI18n } from "@/lib/i18n"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/menu"
import { Segmented } from "@/components/ui/segmented"
import { Tooltip } from "@/components/ui/tooltip"

// onChange 由登录后的外壳传入，用来把选择同步到 v1 Settings；登录页只改本机。
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

// 窄侧栏里放不下分段切换时使用。
export function LanguageMenuButton({
  className,
  onChange,
}: {
  className?: string
  onChange?: (language: UiLanguage) => void
}) {
  const { language, setLanguage, t } = useI18n()
  const current = LANGUAGE_OPTIONS.find((option) => option.value === language) ?? LANGUAGE_OPTIONS[0]
  const choose = onChange ?? setLanguage
  return (
    <DropdownMenu>
      <Tooltip content={`${t.nav.language} · ${current.label}`} side="right">
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`${t.nav.language}: ${current.label}`}
              className={className}
            />
          }
        >
          <span className="text-xs font-semibold">{current.short}</span>
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent align="start" className="min-w-36">
        {LANGUAGE_OPTIONS.map((option) => (
          <DropdownMenuItem key={option.value} onClick={() => choose(option.value)}>
            <span className="flex-1">{option.label}</span>
            {option.value === language ? <Check /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
