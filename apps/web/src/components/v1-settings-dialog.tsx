"use client"

import { FormEvent, useEffect, useState } from "react"
import { Settings as SettingsIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ApiError, isAbortError } from "@/lib/api"
import { LANGUAGE_OPTIONS, useI18n } from "@/lib/i18n"
import { getRuntime, getSettings, patchSettings, type Runtime, type Settings, type UiLanguage } from "@/lib/v1-api"
import { selectClass, useV1Text } from "@/lib/v1-ui"

export function V1SettingsDialog({ onSaved }: { onSaved?: () => void }) {
  const text = useV1Text()
  const { setLanguage } = useI18n()
  const [open, setOpen] = useState(false)
  const [revision, setRevision] = useState(0)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [runtime, setRuntime] = useState<Runtime | null>(null)
  const [adapter, setAdapter] = useState("")
  const [baseUrl, setBaseUrl] = useState("")
  const [apiKey, setApiKey] = useState("")
  const [clearKey, setClearKey] = useState(false)
  const [uiLanguage, setUiLanguage] = useState<UiLanguage>("zh")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    Promise.all([getSettings(controller.signal), getRuntime(controller.signal)]).then(([nextSettings, nextRuntime]) => {
      if (controller.signal.aborted) return
      setSettings(nextSettings)
      setRuntime(nextRuntime)
      setUiLanguage(nextSettings.ui_language)
      const first = nextRuntime.capabilities.find((item) => item.execution === "remote")?.adapter ?? ""
      setAdapter(first)
      setBaseUrl(nextSettings.connections.find((item) => item.adapter === first)?.base_url ?? "")
      setApiKey("")
      setClearKey(false)
    }).catch((err) => {
      if (!controller.signal.aborted && !isAbortError(err)) setError(err instanceof Error ? err.message : String(err))
    })
    return () => controller.abort()
  }, [open, revision])

  async function saveConnection(event: FormEvent) {
    event.preventDefault()
    if (busy || !adapter) return
    setBusy(true)
    setError("")
    setMessage("")
    try {
      const next = await patchSettings({ connection: {
        adapter, base_url: baseUrl.trim(), ...(clearKey ? { api_key: null } : apiKey ? { api_key: apiKey } : {}),
      } })
      setSettings(next)
      setApiKey("")
      setClearKey(false)
      setMessage(text("Connection saved.", "连接已保存。", "接続を保存しました。"))
      onSaved?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      if (err instanceof ApiError && err.code === "SETTINGS_PARTIALLY_APPLIED") {
        // Read back the explicit partial commit, while retaining its error on screen.
        try { setSettings(await getSettings()) } catch (readError) {
          setError(`${err.message} · ${readError instanceof Error ? readError.message : String(readError)}`)
        }
        onSaved?.()
      }
    } finally { setBusy(false) }
  }

  async function saveLanguage() {
    setBusy(true)
    setError("")
    setMessage("")
    try {
      const next = await patchSettings({ ui_language: uiLanguage })
      setSettings(next)
      setLanguage(next.ui_language)
      setMessage(text("Language saved.", "界面语言已保存。", "表示言語を保存しました。"))
      onSaved?.()
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setBusy(false) }
  }

  const connection = settings?.connections.find((item) => item.adapter === adapter)
  return <Dialog open={open} onOpenChange={(next) => {
    setOpen(next)
    if (next) { setSettings(null); setRuntime(null); setError(""); setMessage("") }
  }}>
    <DialogTrigger render={<Button variant="outline" />}><SettingsIcon className="size-4" />{text("Settings", "设置", "設定")}</DialogTrigger>
    <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
      <DialogHeader><DialogTitle>{text("Settings", "设置", "設定")}</DialogTitle>
        <DialogDescription>{text("Connections are stored locally. Saved keys are never displayed.", "连接保存在本机，已保存的密钥不会回显。", "接続はこの端末に保存されます。保存済みのキーは表示されません。")}</DialogDescription>
      </DialogHeader>
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-700">{error}</p>}
      {message && <p role="status" className="text-sky-800">{message}</p>}
      {!settings || !runtime ? <div className="space-y-3">
        {!error && <p>{text("Loading settings…", "正在读取设置…", "設定を読み込み中…")}</p>}
        {error && <Button variant="outline" onClick={() => { setError(""); setRevision((value) => value + 1) }}>{text("Reload", "重新加载", "再読み込み")}</Button>}
      </div> : <>
        <div className="flex items-end gap-3 border-b pb-5">
          <div className="flex-1 space-y-1.5"><Label htmlFor="ui-language">{text("Interface language", "界面语言", "表示言語")}</Label>
            <select id="ui-language" className={selectClass} value={uiLanguage} disabled={busy} onChange={(event) => setUiLanguage(event.target.value as UiLanguage)}>
              {LANGUAGE_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </div>
          <Button variant="outline" onClick={saveLanguage} disabled={busy || uiLanguage === settings.ui_language}>{text("Save language", "保存语言", "言語を保存")}</Button>
        </div>
        <form onSubmit={saveConnection} className="space-y-4">
          <div className="space-y-1.5"><Label htmlFor="connection-adapter">{text("Remote service", "远端服务", "外部サービス")}</Label>
            <select id="connection-adapter" className={selectClass} value={adapter} disabled={busy} onChange={(event) => {
              setAdapter(event.target.value)
              setBaseUrl(settings.connections.find((item) => item.adapter === event.target.value)?.base_url ?? "")
              setApiKey(""); setClearKey(false); setMessage(""); setError("")
            }}>
              {!adapter && <option value="">{text("No remote services registered", "暂无已接入的远端服务", "登録された外部サービスはありません")}</option>}
              {runtime.capabilities.filter((item) => item.execution === "remote").map((item) => <option key={item.adapter} value={item.adapter}>{item.adapter}</option>)}
            </select>
          </div>
          {adapter && <>
            <div className="space-y-1.5"><Label htmlFor="connection-url">{text("Service URL", "服务地址", "サービス URL")}</Label>
              <Input id="connection-url" type="url" required value={baseUrl} disabled={busy} onChange={(event) => setBaseUrl(event.target.value)} />
            </div>
            <div className="space-y-1.5"><Label htmlFor="connection-key">API Key</Label>
              <Input id="connection-key" type="password" autoComplete="new-password" value={apiKey} disabled={busy || clearKey} onChange={(event) => setApiKey(event.target.value)} placeholder={text("Leave blank to keep the saved key", "留空保留已保存的密钥", "空欄で保存済みキーを維持")} />
              <p className="text-xs text-muted-foreground">{connection?.has_api_key ? text("A key is saved.", "已保存密钥。", "キーは保存済みです。") : text("No saved key.", "尚未保存密钥。", "保存済みキーはありません。")}</p>
            </div>
            <label className="flex items-center gap-2"><input type="checkbox" checked={clearKey} disabled={busy || !connection?.has_api_key} onChange={(event) => setClearKey(event.target.checked)} />{text("Clear the saved key", "清除已保存的密钥", "保存済みキーを削除")}</label>
            <Button type="submit" disabled={busy || !baseUrl.trim()}>{busy ? text("Saving…", "保存中…", "保存中…") : text("Save connection", "保存连接", "接続を保存")}</Button>
          </>}
        </form>
      </>}
    </DialogContent>
  </Dialog>
}
