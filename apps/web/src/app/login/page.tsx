"use client"

import Link from "next/link"
import { FormEvent, useState } from "react"
import { Loader2, LogIn } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ApiError } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useI18n } from "@/lib/i18n"

export default function LoginPage() {
  const { login } = useAuth()
  const { t } = useI18n()
  const [password, setPassword] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!password || submitting) return
    setSubmitting(true)
    setError("")
    try {
      await login(password)
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 401
          ? t.auth.invalidCredentials
          : t.auth.loginError,
      )
    } finally {
      setPassword("")
      setSubmitting(false)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[linear-gradient(135deg,#fff5f5_0%,#f2fbff_48%,#fff4fa_100%)] px-4 py-8">
      <div className="w-full max-w-sm space-y-6">
        <Link href="/login" className="flex justify-center" aria-label="YouDub">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/youdub-logo.svg" alt="YouDub" className="h-12 w-auto" />
        </Link>
        <Card>
          <CardHeader>
            <CardTitle>{t.auth.title}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="password">{t.auth.password}</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  autoFocus
                  maxLength={512}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  disabled={submitting}
                  required
                />
              </div>
              {error ? (
                <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
                  {error}
                </p>
              ) : null}
              <Button type="submit" className="w-full" disabled={submitting || !password}>
                {submitting ? <Loader2 className="size-4 animate-spin" /> : <LogIn className="size-4" />}
                {submitting ? t.auth.signingIn : t.auth.signIn}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
