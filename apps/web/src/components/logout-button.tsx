"use client"

import { useState } from "react"
import { Loader2, LogOut } from "lucide-react"

import { useAuth } from "@/lib/auth"
import { useI18n } from "@/lib/i18n"
import { Button } from "@/components/ui/button"
import { Tooltip } from "@/components/ui/tooltip"

export function LogoutButton() {
  const { t } = useI18n()
  const { logout } = useAuth()
  const [loggingOut, setLoggingOut] = useState(false)

  async function handleLogout() {
    if (loggingOut) return
    setLoggingOut(true)
    try {
      await logout()
    } finally {
      setLoggingOut(false)
    }
  }

  const label = loggingOut ? t.auth.loggingOut : t.auth.logout
  return (
    <Tooltip content={label}>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={label}
        onClick={handleLogout}
        disabled={loggingOut}
      >
        {loggingOut ? <Loader2 className="animate-spin" /> : <LogOut />}
      </Button>
    </Tooltip>
  )
}
