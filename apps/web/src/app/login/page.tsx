"use client"

import Link from "next/link"
import { FormEvent, useRef, useState } from "react"
import { ArrowRight, AudioWaveform, Captions, Eye, EyeOff, Languages, Loader2, Mic } from "lucide-react"

import { InlineAlert } from "@/components/inline-alert"
import { BrandMark } from "@/components/brand/brand-mark"
import { LanguageSwitcher } from "@/components/language-switcher"
import { ThemeToggle } from "@/components/theme-toggle"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ApiError } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useI18n } from "@/lib/i18n"

export default function LoginPage() {
  const { login } = useAuth()
  const { language, t } = useI18n()
  const passwordRef = useRef<HTMLInputElement>(null)
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return
    if (!password) {
      setError(t.auth.passwordRequired)
      passwordRef.current?.focus()
      return
    }
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

  // 浅色下每项功能用一种 logo 色点缀图标，深色沿用统一的半透明白。
  const features = [
    { icon: AudioWaveform, label: t.studio.featureSeparate, tool: "Demucs", tint: "bg-[rgb(251_114_153/0.14)] text-[#d6336c]" },
    { icon: Mic, label: t.studio.featureAsr, tool: "Whisper", tint: "bg-[rgb(0_174_236/0.14)] text-[#0277b5]" },
    { icon: Languages, label: t.studio.featureTranslate, tool: "LLM", tint: "bg-[rgb(124_140_255/0.16)] text-[#5550d6]" },
    { icon: Captions, label: t.studio.featureDub, tool: "VoxCPM2", tint: "bg-[rgb(255_0_51/0.1)] text-[#d70a3c]" },
  ]

  return (
    <main className="relative isolate grid min-h-screen overflow-hidden lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      {/* 浅色：整页是一张画布，品牌色光晕从左侧铺开；深色沿用原来的深色品牌区。 */}
      <div aria-hidden="true" className="login-mesh pointer-events-none absolute inset-0 -z-10 dark:hidden" />
      <div aria-hidden="true" className="grain pointer-events-none absolute inset-0 -z-10 opacity-[0.045] mix-blend-multiply dark:hidden" />

      <section className="relative isolate hidden overflow-hidden p-12 lg:flex lg:flex-col xl:p-16 dark:bg-[#07070a] dark:text-white">
        <div aria-hidden="true" className="aurora -z-10 hidden [--aurora-opacity:1] dark:block" />
        <div
          aria-hidden="true"
          className="bg-dot-grid absolute inset-0 -z-10 [--grid-dot:rgb(9_9_11/0.06)] [mask-image:radial-gradient(ellipse_80%_70%_at_30%_40%,black,transparent)] dark:[--grid-dot:rgb(255_255_255/0.06)]"
        />
        <Link href="/login" className="w-fit rounded-md" aria-label="YouDub">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/youdub-wordmark.svg" alt="YouDub" className="h-6 w-auto" />
        </Link>

        <div className="my-auto max-w-lg py-10">
          <BrandMark animated className="h-14" />
          <p className="mt-10 text-5xl leading-[1.1] font-semibold tracking-tight text-balance xl:text-[56px]">
            {t.studio.heroTitleLead}
            {language === "en" ? " " : <br />}
            <span className="text-brand-gradient">{t.studio.heroTitleAccent}</span>
          </p>
          <p className="mt-5 text-base leading-relaxed text-muted-foreground dark:text-white/60">{t.studio.heroSubtitle}</p>
          <ul className="mt-10 grid grid-cols-2 gap-3">
            {features.map((feature) => (
              <li
                key={feature.label}
                className="flex items-center gap-3 rounded-2xl bg-white/60 px-3.5 py-3 shadow-[0_1px_2px_rgb(16_24_40/0.04),0_12px_32px_-18px_rgb(16_24_40/0.22)] ring-1 ring-white/80 backdrop-blur-md dark:rounded-xl dark:bg-white/[0.04] dark:shadow-none dark:ring-white/10"
              >
                <span className={`flex size-9 items-center justify-center rounded-xl dark:size-8 dark:rounded-lg dark:bg-white/[0.06] dark:text-white/80 ${feature.tint}`}>
                  <feature.icon className="size-4" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-foreground dark:text-white/90">{feature.label}</span>
                  <span className="block font-mono text-[11px] text-muted-foreground dark:text-white/45">{feature.tool}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

      </section>

      <section className="relative flex flex-col px-6 py-6 sm:px-10">
        <div className="flex items-center justify-between">
          <Link href="/login" className="rounded-md lg:invisible" aria-label="YouDub">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/youdub-logo.svg" alt="YouDub" className="h-7 w-auto" />
          </Link>
          <div className="flex items-center gap-1">
            <LanguageSwitcher />
            <ThemeToggle />
          </div>
        </div>

        <div className="m-auto w-full max-w-[420px] animate-rise py-12">
          <div className="rounded-[28px] bg-white/80 p-8 shadow-[0_1px_2px_rgb(16_24_40/0.05),0_40px_80px_-40px_rgb(16_24_40/0.35)] ring-1 ring-black/[0.06] backdrop-blur-xl sm:p-10 dark:rounded-none dark:bg-transparent dark:p-0 dark:shadow-none dark:ring-0 dark:backdrop-blur-none">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/youdub-icon.svg" alt="" aria-hidden="true" className="h-9 w-auto" />
            <h1 className="mt-6 text-[28px] font-semibold tracking-tight">{t.auth.welcome}</h1>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t.auth.subtitle}</p>
            <form onSubmit={submit} noValidate className="mt-8 space-y-5">
              <div className="space-y-2">
                <Label htmlFor="password">{t.auth.password}</Label>
                <div className="relative">
                  <Input
                    ref={passwordRef}
                    id="password"
                    type={showPassword ? "text" : "password"}
                    className="h-11 bg-white pr-11 dark:bg-input-bg"
                    autoComplete="current-password"
                    autoFocus
                    maxLength={512}
                    value={password}
                    aria-invalid={error === t.auth.passwordRequired || undefined}
                    onChange={(event) => {
                      setPassword(event.target.value)
                      if (error === t.auth.passwordRequired) setError("")
                    }}
                    disabled={submitting}
                    required
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="absolute top-1.5 right-1.5"
                    aria-label={showPassword ? t.auth.hidePassword : t.auth.showPassword}
                    onClick={() => setShowPassword((current) => !current)}
                  >
                    {showPassword ? <EyeOff /> : <Eye />}
                  </Button>
                </div>
              </div>
              {error ? <InlineAlert>{error}</InlineAlert> : null}
              <Button type="submit" size="xl" className="w-full" disabled={submitting}>
                {submitting ? <Loader2 className="animate-spin" /> : null}
                {submitting ? t.auth.signingIn : t.auth.signIn}
                {submitting ? null : <ArrowRight />}
              </Button>
            </form>
          </div>
        </div>

      </section>
    </main>
  )
}
