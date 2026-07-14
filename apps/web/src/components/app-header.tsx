"use client"

import Link from "next/link"
import { useState } from "react"
import { ArrowLeft, Loader2, LogOut } from "lucide-react"

import { Button } from "@/components/ui/button"
import { SettingsDialog } from "@/components/settings-dialog"
import { useAuth } from "@/lib/auth"
import { useI18n } from "@/lib/i18n"

export function AppHeader({ backHref }: { backHref?: string }) {
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

  return (
    <header className="flex flex-col gap-4 border-b border-[#00aeec]/25 pb-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        {backHref ? (
          <Button
            variant="ghost"
            size="icon-sm"
            nativeButton={false}
            render={<Link href={backHref} aria-label={t.common.back} />}
          >
            <ArrowLeft className="size-4" />
          </Button>
        ) : null}
        <Link href="/" className="flex items-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/youdub-logo.svg"
            alt="YouDub"
            className="h-9 w-auto sm:h-11"
          />
        </Link>
      </div>
      <div className="flex items-center gap-2">
        <SettingsDialog />
        <Button type="button" variant="outline" onClick={handleLogout} disabled={loggingOut}>
          {loggingOut ? <Loader2 className="size-4 animate-spin" /> : <LogOut className="size-4" />}
          {loggingOut ? t.auth.loggingOut : t.auth.logout}
        </Button>
      </div>
    </header>
  )
}
