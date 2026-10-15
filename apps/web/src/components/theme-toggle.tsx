"use client"

import { Moon, Sun } from "lucide-react"

import { useI18n } from "@/lib/i18n"
import { useTheme } from "@/lib/theme"
import { Button } from "@/components/ui/button"
import { Tooltip } from "@/components/ui/tooltip"

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const { t } = useI18n()
  const label = theme === "dark" ? t.nav.switchToLight : t.nav.switchToDark
  return (
    <Tooltip content={label}>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={label}
        onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      >
        {theme === "dark" ? <Sun /> : <Moon />}
      </Button>
    </Tooltip>
  )
}
