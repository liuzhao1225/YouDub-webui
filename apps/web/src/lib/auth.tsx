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

import {
  AUTH_UNAUTHORIZED_EVENT,
  ApiError,
  AuthSession,
  getAuthSession,
  login as loginRequest,
  logout as logoutRequest,
} from "@/lib/api"
import { useI18n } from "@/lib/i18n"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"

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
      <main className="flex min-h-screen items-center justify-center bg-[linear-gradient(135deg,#fff5f5_0%,#f2fbff_48%,#fff4fa_100%)] px-4">
        <Card className="w-full max-w-md">
          <CardContent className="space-y-4 px-6 py-8 text-center">
            <p className="text-sm text-red-700">{sessionError || t.auth.sessionError}</p>
            <Button type="button" variant="outline" onClick={() => setReloadKey((key) => key + 1)}>
              {t.auth.retry}
            </Button>
          </CardContent>
        </Card>
      </main>
    )
  }

  const redirecting =
    status === "loading" ||
    (status === "anonymous" && !isLoginPage) ||
    (status === "authenticated" && isLoginPage)

  if (redirecting) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[linear-gradient(135deg,#fff5f5_0%,#f2fbff_48%,#fff4fa_100%)] px-4">
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
