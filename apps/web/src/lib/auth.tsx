"use client"

import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react"
import { usePathname, useRouter } from "next/navigation"
import { CircleAlert } from "lucide-react"

import {
  AUTH_UNAUTHORIZED_EVENT,
  ApiError,
  AuthSession,
  getAuthSession,
  login as loginRequest,
  logout as logoutRequest,
} from "@/lib/api"
import { useI18n } from "@/lib/i18n"
import { BrandMark } from "@/components/brand/brand-mark"
import { Button } from "@/components/ui/button"

type AuthStatus = "loading" | "authenticated" | "anonymous" | "error"

type AuthContextValue = {
  session: AuthSession | null
  login: (password: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const { t } = useI18n()
  const [session, setSession] = useState<AuthSession | null>(null)
  const [status, setStatus] = useState<AuthStatus>("loading")
  const [sessionError, setSessionError] = useState("")
  const [reloadKey, setReloadKey] = useState(0)
  const isLoginPage = pathname === "/login"

  useEffect(() => {
    let cancelled = false

    getAuthSession()
      .then((next) => {
        if (cancelled) return
        setSession(next)
        setSessionError("")
        setStatus("authenticated")
      })
      .catch((error) => {
        if (cancelled) return
        setSession(null)
        if (error instanceof ApiError && error.status === 401) {
          setSessionError("")
          setStatus("anonymous")
          return
        }
        setSessionError(error instanceof Error ? error.message : t.auth.sessionError)
        setStatus("error")
      })

    return () => {
      cancelled = true
    }
  }, [reloadKey, t.auth.sessionError])

  useEffect(() => {
    const handleUnauthorized = () => {
      setSession(null)
      setSessionError("")
      setStatus("anonymous")
    }
    window.addEventListener(AUTH_UNAUTHORIZED_EVENT, handleUnauthorized)
    return () => window.removeEventListener(AUTH_UNAUTHORIZED_EVENT, handleUnauthorized)
  }, [])

  useEffect(() => {
    if (status === "anonymous" && !isLoginPage) router.replace("/login")
    if (status === "authenticated" && isLoginPage) router.replace("/")
  }, [isLoginPage, router, status])

  const login = useCallback(async (password: string) => {
    const next = await loginRequest(password)
    setSession(next)
    setSessionError("")
    setStatus("authenticated")
  }, [])

  const logout = useCallback(async () => {
    try {
      await logoutRequest()
    } finally {
      setSession(null)
      setSessionError("")
      setStatus("anonymous")
    }
  }, [])

  const value = useMemo<AuthContextValue>(() => ({ session, login, logout }), [login, logout, session])

  if (status === "error") {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="flex w-full max-w-md flex-col items-center gap-4 rounded-2xl border border-border bg-card px-6 py-10 text-center shadow-float">
          <span className="flex size-11 items-center justify-center rounded-full bg-status-danger/10 text-status-danger-fg">
            <CircleAlert className="size-5" />
          </span>
          <p className="text-sm leading-relaxed text-status-danger-fg">{sessionError || t.auth.sessionError}</p>
          <Button type="button" variant="outline" onClick={() => setReloadKey((key) => key + 1)}>
            {t.auth.retry}
          </Button>
        </div>
      </main>
    )
  }

  const redirecting =
    status === "loading" ||
    (status === "anonymous" && !isLoginPage) ||
    (status === "authenticated" && isLoginPage)

  if (redirecting) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-4">
        <BrandMark animated className="h-12" />
        <p className="text-sm text-muted-foreground">{t.auth.sessionLoading}</p>
      </main>
    )
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error("useAuth must be used inside AuthProvider")
  return context
}
