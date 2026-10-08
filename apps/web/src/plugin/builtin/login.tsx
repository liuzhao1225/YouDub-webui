import { Context } from 'cordis'
import { useState, type FormEvent } from 'react'
import { ArrowRight, Eye, EyeOff, Loader2 } from 'lucide-react'
import { useClient, useObservable } from '../sdk'
import { BrandMark } from '@/components/brand/brand-mark'
import { useI18n } from '@/lib/i18n'
import { LanguageSwitcher } from '@/components/language-switcher'
import { ThemeToggle } from '@/components/theme-toggle'
import { InlineAlert } from '@/components/inline-alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
function Login() {
  const { session } = useClient()
  const snapshot = useObservable(session)
  const { t } = useI18n()
  const [password, setPassword] = useState(''), [visible, setVisible] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('')
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy) return
    setBusy(true); setError('')
    try { await session.login(password) } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { setBusy(false); setPassword('') }
  }
  return <main className="relative isolate grid min-h-screen overflow-hidden lg:grid-cols-2">
    <div aria-hidden className="login-mesh pointer-events-none absolute inset-0 -z-10 dark:hidden" />
    <section className="relative isolate hidden flex-col justify-center overflow-hidden p-16 lg:flex dark:bg-[#07070a]"><div aria-hidden className="aurora -z-10 hidden dark:block" /><BrandMark animated className="mb-10 h-14 self-start" /><h1 className="text-5xl font-semibold tracking-tight">{t.studio.heroTitleLead}<br /><span className="text-brand-gradient">{t.studio.heroTitleAccent}</span></h1><p className="mt-5 max-w-md text-base leading-relaxed text-muted-foreground">{t.studio.heroSubtitle}</p></section>
    <section className="flex min-h-screen flex-col px-6 py-6"><div className="flex justify-end gap-2"><LanguageSwitcher /><ThemeToggle /></div><form onSubmit={(event) => void submit(event)} className="m-auto w-full max-w-sm space-y-6"><img src="/youdub-logo.svg" alt="YouDub" className="mb-10 h-9 w-auto" /><div><h2 className="text-2xl font-semibold">{t.auth.welcome}</h2><p className="mt-2 text-sm text-muted-foreground">{t.auth.subtitle}</p></div><div className="space-y-2"><Label htmlFor="access-password">{t.auth.password}</Label><div className="relative"><Input id="access-password" autoComplete="current-password" autoFocus type={visible ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} className="pr-10" required /><Button type="button" variant="ghost" size="icon-sm" className="absolute top-0.5 right-1" aria-label={visible ? t.auth.hidePassword : t.auth.showPassword} onClick={() => setVisible(!visible)}>{visible ? <EyeOff /> : <Eye />}</Button></div></div>{(error || snapshot.error) && <InlineAlert>{error || snapshot.error}</InlineAlert>}<Button type="submit" className="w-full" size="xl" disabled={busy || !password}>{busy ? <Loader2 className="animate-spin" /> : <ArrowRight />}{t.auth.signIn}</Button></form></section>
  </main>
}
export const name = 'client-login'
export const inject = ['slots', 'session']
export function apply(ctx: Context) { ctx.effect(() => ctx.slots.register('shell.routes', { id: 'login', path: '/login', component: Login, access: 'public' })) }
