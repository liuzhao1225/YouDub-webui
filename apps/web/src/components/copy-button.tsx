"use client"

import { useEffect, useRef, useState } from "react"
import { Check, Copy } from "lucide-react"

import { copyText } from "@/lib/clipboard"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Tooltip } from "@/components/ui/tooltip"

export function CopyButton({ value, className }: { value: string; className?: string }) {
  const { t } = useI18n()
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<number | null>(null)

  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
  }, [])

  async function handleCopy() {
    if (!(await copyText(value))) return
    setCopied(true)
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => setCopied(false), 1500)
  }

  const label = copied ? t.common.copied : t.common.copy
  return (
    <Tooltip content={label}>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={label}
        onClick={handleCopy}
        className={cn("shrink-0", className)}
      >
        {copied ? <Check className="text-status-success-fg" /> : <Copy />}
      </Button>
    </Tooltip>
  )
}
