"use client"

import { FormEvent, useEffect, useState } from "react"
import { Eye, EyeOff, RefreshCw, Settings } from "lucide-react"

import {
  ApiError,
  getCookieInfo,
  getOpenAIModels,
  getOpenAISettings,
  getYtdlpSettings,
  saveCookie,
  saveOpenAISettings,
  saveYtdlpSettings,
} from "@/lib/api"
import { LANGUAGE_OPTIONS, useI18n } from "@/lib/i18n"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"

type SettingsForm = {
  cookie: string
  baseUrl: string
  apiKey: string
  model: string
  translateConcurrency: string
  proxyPort: string
}

const SAVED_API_KEY_MASK = "********"
const SAVED_COOKIE_SENTINEL = "__YOUDUB_SAVED_COOKIE__"

type MessageKey = "keySaved"
type SaveSection = "cookie" | "openai" | "ytdlp"
type SaveResult = {
  section: SaveSection
  status: "saved" | "failed" | "unchanged"
  httpStatus?: number
}

const defaultSettings: SettingsForm = {
  cookie: "",
  baseUrl: "https://api.openai.com/v1",
  apiKey: "",
  model: "gpt-4o-mini",
  translateConcurrency: "50",
  proxyPort: "",
}

function uniqueModels(models: string[]) {
  return Array.from(new Set(models.map((model) => model.trim()).filter(Boolean)))
}

export function SettingsDialog() {
  const { language, loadedModelsText, setLanguage, t } = useI18n()
  const [open, setOpen] = useState(false)
  const [settings, setSettings] = useState(defaultSettings)
  const [message, setMessage] = useState("")
  const [messageKey, setMessageKey] = useState<MessageKey | null>(null)
  const [modelOptions, setModelOptions] = useState<string[]>([])
  const [modelsLoaded, setModelsLoaded] = useState(false)
  const [modelsLoading, setModelsLoading] = useState(false)
  const [showApiKey, setShowApiKey] = useState(false)
  const [cookieDirty, setCookieDirty] = useState(false)
  const [apiKeyDirty, setApiKeyDirty] = useState(false)
  const [saveResults, setSaveResults] = useState<SaveResult[]>([])
  const [saving, setSaving] = useState(false)

  const cookieValue =
    settings.cookie === SAVED_COOKIE_SENTINEL ? t.settings.savedCookie : settings.cookie
  const visibleMessage = messageKey === "keySaved" ? t.settings.keySaved : message

  useEffect(() => {
    if (!open) return
    Promise.all([getCookieInfo(), getOpenAISettings(), getYtdlpSettings()])
      .then(([cookie, openai, ytdlp]) => {
        setSettings({
          cookie: cookie.exists ? SAVED_COOKIE_SENTINEL : "",
          baseUrl: openai.base_url,
          apiKey: openai.has_api_key ? openai.api_key || SAVED_API_KEY_MASK : "",
          model: openai.model,
          translateConcurrency: openai.translate_concurrency || "50",
          proxyPort: ytdlp.proxy_port,
        })
        setModelOptions(uniqueModels([openai.model]))
        setModelsLoaded(false)
        setShowApiKey(false)
        setCookieDirty(false)
        setApiKeyDirty(false)
        setSaveResults([])
        setMessage("")
        setMessageKey(openai.has_api_key ? "keySaved" : null)
      })
      .catch((err) => {
        setMessageKey(null)
        setMessage(err.message)
      })
  }, [open])

  async function refreshSettingsFromServer() {
    const [cookieResult, openaiResult, ytdlpResult] = await Promise.allSettled([
      getCookieInfo(),
      getOpenAISettings(),
      getYtdlpSettings(),
    ])

    setSettings((current) => {
      const refreshed = { ...current }
      if (cookieResult.status === "fulfilled") {
        refreshed.cookie = cookieResult.value.exists ? SAVED_COOKIE_SENTINEL : ""
      }
      if (openaiResult.status === "fulfilled") {
        const openai = openaiResult.value
        refreshed.baseUrl = openai.base_url
        refreshed.apiKey = openai.has_api_key ? openai.api_key || SAVED_API_KEY_MASK : ""
        refreshed.model = openai.model
        refreshed.translateConcurrency = openai.translate_concurrency || "50"
      }
      if (ytdlpResult.status === "fulfilled") {
        refreshed.proxyPort = ytdlpResult.value.proxy_port
      }
      return refreshed
    })

    if (cookieResult.status === "fulfilled") setCookieDirty(false)
    if (openaiResult.status === "fulfilled") {
      setApiKeyDirty(false)
      setShowApiKey(false)
      setModelOptions(uniqueModels([openaiResult.value.model]))
      setModelsLoaded(false)
    }

    return [cookieResult, openaiResult, ytdlpResult].every(
      (result) => result.status === "fulfilled",
    )
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMessage("")
    setMessageKey(null)
    setSaveResults([])
    setSaving(true)
    const results: SaveResult[] = []

    async function saveSection(section: SaveSection, action: () => Promise<unknown>) {
      try {
        await action()
        results.push({ section, status: "saved" })
      } catch (err) {
        results.push({
          section,
          status: "failed",
          httpStatus: err instanceof ApiError ? err.status : undefined,
        })
      }
    }

    try {
      if (cookieDirty) {
        await saveSection("cookie", () => saveCookie(settings.cookie))
      } else {
        results.push({ section: "cookie", status: "unchanged" })
      }
      const clearApiKey = apiKeyDirty && !settings.apiKey.trim()
      await saveSection("openai", () => saveOpenAISettings({
        base_url: settings.baseUrl,
        api_key: apiKeyDirty ? settings.apiKey : "",
        clear_api_key: clearApiKey,
        model: settings.model,
        translate_concurrency: settings.translateConcurrency,
      }))
      await saveSection("ytdlp", () => saveYtdlpSettings({ proxy_port: settings.proxyPort }))
      setSaveResults(results)
      setSettings((current) => ({
        ...current,
        cookie: cookieDirty ? "" : current.cookie,
        apiKey: apiKeyDirty ? "" : current.apiKey,
      }))
      if (cookieDirty) setCookieDirty(false)
      if (apiKeyDirty) setApiKeyDirty(false)
      setShowApiKey(false)

      const refreshed = await refreshSettingsFromServer()
      if (!refreshed) setMessage(t.settings.reloadError)
    } finally {
      setSaving(false)
    }
  }

  async function fetchModels() {
    setMessage("")
    setMessageKey(null)
    setModelsLoading(true)
    try {
      const response = await getOpenAIModels({
        base_url: settings.baseUrl,
        api_key: apiKeyDirty ? settings.apiKey : "",
      })
      const models = uniqueModels([settings.model, ...response.models])
      setModelOptions(models)
      setModelsLoaded(true)
      setSettings((current) => ({ ...current, model: current.model || models[0] || "" }))
      setMessage(models.length ? loadedModelsText(models.length) : t.settings.noModels)
    } catch (err) {
      setMessageKey(null)
      setMessage(err instanceof Error ? err.message : t.settings.loadModelsError)
    } finally {
      setModelsLoading(false)
    }
  }

  const saveSectionLabels: Record<SaveSection, string> = {
    cookie: t.settings.cookie,
    openai: t.settings.openaiSaveSection,
    ytdlp: t.settings.ytdlpSaveSection,
  }

  function saveResultText(result: SaveResult) {
    if (result.status === "saved") return t.settings.saveSucceeded
    if (result.status === "unchanged") return t.settings.saveUnchanged
    return `${t.settings.saveFailed}${result.httpStatus ? ` (HTTP ${result.httpStatus})` : ""}`
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" />}>
        <Settings className="size-4" />
        {t.settings.button}
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-hidden sm:max-w-2xl">
        <form onSubmit={submit} className="flex max-h-[calc(100dvh-4rem)] min-h-0 flex-col">
          <DialogHeader className="shrink-0 pr-8">
            <DialogTitle>{t.settings.title}</DialogTitle>
            <DialogDescription>{t.settings.description}</DialogDescription>
          </DialogHeader>
          <div className="mt-4 min-h-0 overflow-y-auto pr-1">
            <div className="grid gap-4 pb-4">
              <div className="grid gap-2">
                <Label htmlFor="uiLanguage">{t.settings.language}</Label>
                <Select
                  value={language}
                  onValueChange={(value) => {
                    if (value === "en" || value === "zh") setLanguage(value)
                  }}
                >
                  <SelectTrigger id="uiLanguage">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LANGUAGE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="cookie">{t.settings.cookie}</Label>
                <Textarea
                  id="cookie"
                  value={cookieValue}
                  onFocus={(event) => {
                    if (!cookieDirty && settings.cookie === SAVED_COOKIE_SENTINEL) {
                      event.currentTarget.select()
                    }
                  }}
                  onChange={(event) => {
                    setCookieDirty(true)
                    setSettings((current) => ({
                      ...current,
                      cookie:
                        current.cookie === SAVED_COOKIE_SENTINEL
                          ? event.target.value.replace(t.settings.savedCookie, "")
                          : event.target.value,
                    }))
                  }}
                  placeholder={t.settings.cookiePlaceholder}
                  className="min-h-44 max-h-[42dvh] overflow-auto font-mono text-xs leading-relaxed"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="proxyPort">{t.settings.proxyPort}</Label>
                <Input
                  id="proxyPort"
                  inputMode="numeric"
                  value={settings.proxyPort}
                  onChange={(event) =>
                    setSettings((current) => ({ ...current, proxyPort: event.target.value }))
                  }
                  placeholder="7890"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="baseUrl">{t.settings.baseUrl}</Label>
                <Input
                  id="baseUrl"
                  value={settings.baseUrl}
                  onChange={(event) =>
                    setSettings((current) => ({ ...current, baseUrl: event.target.value }))
                  }
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="apiKey">{t.settings.apiKey}</Label>
                <div className="relative">
                  <Input
                    id="apiKey"
                    type={showApiKey ? "text" : "password"}
                    value={settings.apiKey}
                    onFocus={(event) => {
                      if (!apiKeyDirty && settings.apiKey === SAVED_API_KEY_MASK) {
                        event.currentTarget.select()
                      }
                    }}
                    onChange={(event) => {
                      setApiKeyDirty(true)
                      setSettings((current) => ({
                        ...current,
                        apiKey: event.target.value.replace(SAVED_API_KEY_MASK, ""),
                      }))
                    }}
                    placeholder={t.settings.apiKeyPlaceholder}
                    className="pr-9"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="absolute top-0.5 right-0.5"
                    onClick={() => setShowApiKey((current) => !current)}
                  >
                    {showApiKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    <span className="sr-only">{showApiKey ? t.settings.hideApiKey : t.settings.showApiKey}</span>
                  </Button>
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                <div className="grid gap-2">
                  <Label htmlFor="model">{t.settings.model}</Label>
                  {modelsLoaded && modelOptions.length > 0 ? (
                    <Select
                      value={settings.model}
                      onValueChange={(value) =>
                        setSettings((current) => ({ ...current, model: value || "" }))
                      }
                    >
                      <SelectTrigger id="model">
                        <SelectValue placeholder={t.settings.selectModel} />
                      </SelectTrigger>
                      <SelectContent>
                        {modelOptions.map((model) => (
                          <SelectItem key={model} value={model}>
                            {model}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      id="model"
                      value={settings.model}
                      onChange={(event) =>
                        setSettings((current) => ({ ...current, model: event.target.value }))
                      }
                    />
                  )}
                </div>
                <div className="grid gap-2 sm:self-end">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={fetchModels}
                    disabled={modelsLoading || !settings.baseUrl.trim()}
                  >
                    <RefreshCw className="size-4" />
                    {modelsLoading ? t.settings.loading : t.settings.getModels}
                  </Button>
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="translateConcurrency">{t.settings.translateConcurrency}</Label>
                <Input
                  id="translateConcurrency"
                  inputMode="numeric"
                  value={settings.translateConcurrency}
                  onChange={(event) =>
                    setSettings((current) => ({
                      ...current,
                      translateConcurrency: event.target.value.replace(/[^0-9]/g, ""),
                    }))
                  }
                  placeholder="50"
                />
                <p className="text-xs text-muted-foreground">
                  {t.settings.concurrencyHelp}
                </p>
              </div>
              {saveResults.length > 0 ? (
                <div
                  data-testid="settings-save-results"
                  className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-sm"
                  aria-live="polite"
                >
                  <p className="font-medium">{t.settings.saveResultsTitle}</p>
                  <ul className="mt-1 space-y-1">
                    {saveResults.map((result) => (
                      <li
                        key={result.section}
                        className={result.status === "failed" ? "text-red-700" : "text-muted-foreground"}
                      >
                        {saveSectionLabels[result.section]}: {saveResultText(result)}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {visibleMessage ? <p className="text-sm text-muted-foreground">{visibleMessage}</p> : null}
            </div>
          </div>
          <DialogFooter className="shrink-0">
            <Button type="submit" disabled={saving}>
              {saving ? t.settings.saving : t.settings.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
