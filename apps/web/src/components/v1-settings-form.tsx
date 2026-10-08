"use client"

import { FormEvent, ReactNode, useEffect, useState } from "react"
import {
  CircleCheck,
  Cpu,
  Eye,
  EyeOff,
  Loader2,
  Moon,
  Palette,
  Plug,
  RefreshCw,
  Sun,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react"

import { ApiError, isAbortError } from "@/lib/api"
import { formatBytes } from "@/lib/format"
import { LANGUAGE_OPTIONS, type UiLanguage, useI18n } from "@/lib/i18n"
import { useTheme } from "@/lib/theme"
import { cn } from "@/lib/utils"
import { getRuntime, getSettings, patchSettings, type Capability, type ConnectionRead, type Runtime, type Settings } from "@/lib/v1-api"
import { deviceName, useV1Text } from "@/lib/v1-ui"
import { InlineAlert } from "@/components/inline-alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Segmented } from "@/components/ui/segmented"
import { Skeleton } from "@/components/ui/skeleton"

// 已保存的密钥只在系统凭据库里，这里用圆点表示“已有密钥”；输入新内容即替换。
const SAVED_KEY_MASK = "••••••••••••••••"

const CAPABILITY_LABELS: Record<Capability["capability"], [string, string, string]> = {
  separation: ["Vocal separation", "人声分离", "音声分離"],
  asr: ["Speech recognition", "语音识别", "音声認識"],
  translation: ["Translation", "翻译", "翻訳"],
  tts: ["Voice generation", "配音生成", "音声合成"],
  subtitle_alignment: ["Subtitle alignment (optional)", "字幕对齐（可选）", "字幕の位置合わせ（任意）"],
}

function SettingsSection({ icon: Icon, title, description, action, children }: {
  icon: LucideIcon
  title: string
  description?: ReactNode
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-card">
      <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4 sm:px-6">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent text-muted-foreground ring-1 ring-border ring-inset">
            <Icon className="size-4" />
          </span>
          <div>
            <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
            {description ? <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">{description}</p> : null}
          </div>
        </div>
        {action}
      </div>
      <div className="divide-y divide-border px-5 sm:px-6">{children}</div>
    </section>
  )
}

function SettingsRow({ label, htmlFor, description, children }: {
  label: string
  htmlFor?: string
  description?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="grid gap-3 py-5 md:grid-cols-[minmax(0,13rem)_minmax(0,1fr)] md:gap-8">
      <div className="min-w-0">
        {htmlFor ? <Label htmlFor={htmlFor}>{label}</Label> : <p className="text-[13px] leading-5 font-medium">{label}</p>}
        {description ? <div className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</div> : null}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

function ConnectionForm({ adapter, connection, requiresKey, onSettings }: {
  adapter: string
  connection: ConnectionRead | undefined
  requiresKey: boolean
  onSettings: (settings: Settings) => void
}) {
  const text = useV1Text()
  const [baseUrl, setBaseUrl] = useState(connection?.base_url ?? "")
  const [apiKey, setApiKey] = useState("")
  const [showKey, setShowKey] = useState(false)
  const [clearKey, setClearKey] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [saved, setSaved] = useState(false)

  const hasKey = Boolean(connection?.has_api_key)
  // 更换地址时后端不会把旧密钥发往新地址，保存后旧密钥即被移除。
  const urlChanged = Boolean(connection) && baseUrl.trim() !== connection?.base_url
  const keyDropped = hasKey && urlChanged && !apiKey
  const showSavedMask = hasKey && !clearKey && !apiKey && !urlChanged
  const urlId = `connection-url-${adapter}`
  const keyId = `connection-key-${adapter}`

  async function save(event: FormEvent) {
    event.preventDefault()
    if (busy || !baseUrl.trim()) return
    setBusy(true)
    setError("")
    setSaved(false)
    try {
      const next = await patchSettings({ connection: {
        adapter, base_url: baseUrl.trim(), ...(clearKey ? { api_key: null } : apiKey ? { api_key: apiKey } : {}),
      } })
      onSettings(next)
      setBaseUrl(next.connections.find((item) => item.adapter === adapter)?.base_url ?? baseUrl.trim())
      setApiKey("")
      setShowKey(false)
      setClearKey(false)
      setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      if (err instanceof ApiError && err.code === "SETTINGS_PARTIALLY_APPLIED") {
        // 部分写入时读回实际状态，同时保留错误提示。
        try { onSettings(await getSettings()) } catch (readError) {
          setError(`${err.message} · ${readError instanceof Error ? readError.message : String(readError)}`)
        }
      }
    } finally { setBusy(false) }
  }

  return (
    <form onSubmit={save} aria-label={adapter}>
      <SettingsRow label={text("Service URL", "服务地址", "サービス URL")} htmlFor={urlId}
        description={text("OpenAI-compatible Chat Completions endpoint.", "OpenAI 兼容的 Chat Completions 接口地址。", "OpenAI 互換の Chat Completions エンドポイント。")}>
        <Input id={urlId} type="url" required value={baseUrl} disabled={busy} className="font-mono"
          placeholder="https://api.openai.com/v1"
          onChange={(event) => { setBaseUrl(event.target.value); setSaved(false) }} />
      </SettingsRow>
      <SettingsRow label="API Key" htmlFor={keyId}
        description={text("Stored in this computer's system keychain. Saved keys are never displayed.", "保存在本机系统凭据库，已保存的密钥不会回显。", "この端末のシステムのキーチェーンに保存されます。保存済みのキーは表示されません。")}>
        <div className="relative">
          <Input
            id={keyId}
            type={showKey ? "text" : "password"}
            autoComplete="new-password"
            spellCheck={false}
            value={apiKey}
            disabled={busy || clearKey}
            aria-invalid={(keyDropped && requiresKey) || undefined}
            placeholder={showSavedMask ? SAVED_KEY_MASK : undefined}
            className={cn("pr-11 font-mono", showSavedMask && "placeholder:text-foreground")}
            onChange={(event) => { setApiKey(event.target.value); setSaved(false) }}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="absolute top-1 right-1"
            disabled={!apiKey}
            onClick={() => setShowKey((current) => !current)}
          >
            {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            <span className="sr-only">{showKey ? text("Hide API key", "隐藏 API Key", "API キーを隠す") : text("Show API key", "显示 API Key", "API キーを表示")}</span>
          </Button>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
          {keyDropped ? (
            <span className="inline-flex items-start gap-1.5 text-status-warning-fg">
              <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
              {text("The saved key is never sent to a new address; saving removes it. Enter the key for the new URL.", "已保存的密钥不会发往新地址，保存时会被移除，请填写新地址的密钥。", "保存済みのキーは新しいアドレスには送信されず、保存時に削除されます。新しい URL のキーを入力してください。")}
            </span>
          ) : clearKey ? (
            <span className="inline-flex items-center gap-1.5 text-status-warning-fg">
              <TriangleAlert className="size-3.5" aria-hidden="true" />
              {text("The saved key will be cleared when you save.", "保存后将清除已保存的密钥。", "保存すると保存済みのキーを削除します。")}
              <button type="button" onClick={() => setClearKey(false)} className="font-medium underline-offset-2 hover:underline">
                {text("Undo", "撤销", "元に戻す")}
              </button>
            </span>
          ) : hasKey ? (
            <span className="inline-flex items-center gap-1.5 text-status-success-fg">
              <CircleCheck className="size-3.5" aria-hidden="true" />
              {text("A key is saved.", "已保存密钥。", "キーは保存済みです。")}
              <span aria-hidden="true" className="text-subtle-foreground">·</span>
              <button
                type="button"
                onClick={() => { setClearKey(true); setApiKey(""); setSaved(false) }}
                className="font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                {text("Clear the saved key", "清除已保存的密钥", "保存済みキーを削除")}
              </button>
            </span>
          ) : (
            <span className="text-muted-foreground">{text("No saved key.", "尚未保存密钥。", "保存済みキーはありません。")}</span>
          )}
        </div>
      </SettingsRow>
      <div className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-end">
        <div className="min-w-0 flex-1 text-[13px]" aria-live="polite">
          {error ? <InlineAlert>{error}</InlineAlert> : saved ? (
            <p role="status" className="flex items-center gap-1.5 text-status-success-fg">
              <CircleCheck className="size-3.5" aria-hidden="true" />
              {text("Connection saved.", "连接已保存。", "接続を保存しました。")}
            </p>
          ) : null}
        </div>
        <Button type="submit" disabled={busy || !baseUrl.trim()}>
          {busy ? <Loader2 className="animate-spin" /> : null}
          {busy ? text("Saving…", "保存中…", "保存中…") : text("Save connection", "保存连接", "接続を保存")}
        </Button>
      </div>
    </form>
  )
}

export function V1SettingsForm() {
  const { language, setLanguage, t } = useI18n()
  const { theme, setTheme } = useTheme()
  const text = useV1Text()
  const [settings, setSettings] = useState<Settings | null>(null)
  const [runtime, setRuntime] = useState<Runtime | null>(null)
  const [loadError, setLoadError] = useState("")
  const [revision, setRevision] = useState(0)
  const [runtimeLoading, setRuntimeLoading] = useState(false)
  const [runtimeError, setRuntimeError] = useState("")
  const [languageState, setLanguageState] = useState<{ saving: boolean; saved: boolean; error: string }>({ saving: false, saved: false, error: "" })

  useEffect(() => {
    const controller = new AbortController()
    Promise.all([getSettings(controller.signal), getRuntime(controller.signal)]).then(([nextSettings, nextRuntime]) => {
      if (controller.signal.aborted) return
      setSettings(nextSettings)
      setRuntime(nextRuntime)
    }).catch((err) => {
      if (!controller.signal.aborted && !isAbortError(err)) setLoadError(err instanceof Error ? err.message : String(err))
    })
    return () => controller.abort()
  }, [revision])

  async function changeLanguage(next: UiLanguage) {
    setLanguage(next)
    setLanguageState({ saving: true, saved: false, error: "" })
    try {
      setSettings(await patchSettings({ ui_language: next }))
      setLanguageState({ saving: false, saved: true, error: "" })
    } catch (err) {
      setLanguageState({ saving: false, saved: false, error: err instanceof Error ? err.message : String(err) })
    }
  }

  async function refreshRuntime() {
    setRuntimeLoading(true)
    setRuntimeError("")
    try { setRuntime(await getRuntime()) }
    catch (err) { setRuntimeError(err instanceof Error ? err.message : String(err)) }
    finally { setRuntimeLoading(false) }
  }

  // 同一适配器可能声明多项能力，连接只按适配器配置一次。
  const remoteAdapters = runtime
    ? runtime.capabilities.filter((item) => item.execution === "remote")
      .filter((item, index, list) => list.findIndex((other) => other.adapter === item.adapter) === index)
    : []

  return (
    <div className="space-y-6">
      <SettingsSection icon={Palette} title={text("General", "通用", "一般")}>
        <SettingsRow label={t.nav.language} description={text("Saved to this deployment and used after the next sign-in.", "保存到本部署，下次登录后沿用。", "このデプロイに保存され、次回ログイン後も使われます。")}>
          <div className="flex flex-wrap items-center gap-3">
            <Segmented
              ariaLabel={t.nav.language}
              value={language}
              onChange={(next) => void changeLanguage(next)}
              options={LANGUAGE_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
            />
            <span className="text-xs" aria-live="polite">
              {languageState.saving ? <Loader2 className="size-3.5 animate-spin text-muted-foreground" /> : languageState.saved ? (
                <span role="status" className="inline-flex items-center gap-1.5 text-status-success-fg">
                  <CircleCheck className="size-3.5" aria-hidden="true" />
                  {text("Language saved.", "界面语言已保存。", "表示言語を保存しました。")}
                </span>
              ) : null}
            </span>
          </div>
          {languageState.error ? <InlineAlert className="mt-3">{languageState.error}</InlineAlert> : null}
        </SettingsRow>
        <SettingsRow label={t.nav.theme} description={text("Applies to this browser.", "只对当前浏览器生效。", "このブラウザーにのみ適用されます。")}>
          <Segmented
            ariaLabel={t.nav.theme}
            value={theme}
            onChange={setTheme}
            options={[
              { value: "dark", label: t.nav.themeDark, icon: <Moon /> },
              { value: "light", label: t.nav.themeLight, icon: <Sun /> },
            ]}
          />
        </SettingsRow>
      </SettingsSection>

      {loadError ? (
        <InlineAlert>
          <span className="flex flex-wrap items-center justify-between gap-2">
            <span>{loadError}</span>
            <Button type="button" variant="outline" size="xs" onClick={() => { setLoadError(""); setRevision((value) => value + 1) }}>
              {text("Reload", "重新加载", "再読み込み")}
            </Button>
          </span>
        </InlineAlert>
      ) : null}

      <SettingsSection
        icon={Plug}
        title={text("Translation service", "翻译服务", "翻訳サービス")}
        description={text(
          "Translation calls an OpenAI-compatible Chat Completions API. The service must support JSON output and accept an output limit of 65,535 tokens.",
          "翻译通过 OpenAI 兼容的 Chat Completions 接口调用。服务需支持 JSON 输出，并接受 65535 的输出上限。",
          "翻訳は OpenAI 互換の Chat Completions API を呼び出します。JSON 出力に対応し、出力上限 65,535 を受け付けるサービスが必要です。",
        )}
      >
        {!settings || !runtime ? (
          loadError ? null : <div className="space-y-3 py-5"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
        ) : remoteAdapters.length === 0 ? (
          <p className="py-5 text-sm text-muted-foreground">{text("No remote services registered", "暂无已接入的远端服务", "登録された外部サービスはありません")}</p>
        ) : remoteAdapters.map((capability) => (
          <ConnectionForm
            key={capability.adapter}
            adapter={capability.adapter}
            connection={settings.connections.find((item) => item.adapter === capability.adapter)}
            requiresKey={capability.requires_api_key}
            onSettings={setSettings}
          />
        ))}
      </SettingsSection>


      <SettingsSection
        icon={Cpu}
        title={text("Runtime", "运行环境", "実行環境")}
        description={runtime ? (
          <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className={cn("inline-flex items-center gap-1.5 font-medium", runtime.status === "ready" ? "text-status-success-fg" : "text-status-warning-fg")}>
              <span aria-hidden="true" className={cn("size-1.5 rounded-full", runtime.status === "ready" ? "bg-status-success" : "bg-status-warning")} />
              {runtime.status === "ready" ? text("All core models ready", "基础能力全部就绪", "基本機能はすべて利用可能") : text("Some models are unavailable", "部分能力不可用", "一部のモデルが利用できません")}
            </span>
            <span aria-hidden="true">·</span>
            <span>{runtime.platform} · {runtime.arch}</span>
          </span>
        ) : text("Models, devices and input limits detected on this computer.", "本机检测到的模型、设备与输入限制。", "この端末で検出されたモデル・デバイス・入力制限。")}
        action={
          <Button variant="ghost" size="sm" onClick={refreshRuntime} disabled={runtimeLoading || !runtime}>
            <RefreshCw className={cn(runtimeLoading && "animate-spin")} />
            {text("Refresh", "刷新", "更新")}
          </Button>
        }
      >
        {runtimeError ? <div className="py-4"><InlineAlert>{runtimeError}</InlineAlert></div> : null}
        {!runtime ? (
          loadError ? null : <div className="space-y-3 py-5"><Skeleton className="h-6 w-2/3" /><Skeleton className="h-6 w-1/2" /></div>
        ) : (
          <>
            <ul aria-label={text("Model availability", "模型可用性", "モデルの利用状況")} className="divide-y divide-border">
              {runtime.capabilities.map((item) => (
                <li key={`${item.adapter}-${item.capability}`} className="grid gap-1.5 py-4 md:grid-cols-[minmax(0,13rem)_minmax(0,1fr)] md:gap-8">
                  <div className="flex items-center gap-2 text-[13px] font-medium">
                    <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", item.available ? "bg-status-success" : "bg-status-warning")} />
                    {text(...CAPABILITY_LABELS[item.capability])}
                  </div>
                  <div className="min-w-0 text-[13px]">
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-mono text-xs">{item.adapter}</span>
                      <span className="rounded-md bg-accent px-1.5 py-0.5 text-[11px] text-muted-foreground">
                        {item.execution === "remote" ? text("Remote", "远端", "リモート") : text("Local", "本机", "ローカル")}
                      </span>
                    </p>
                    <p className={cn("mt-1 text-xs leading-relaxed break-words", item.available ? "text-muted-foreground" : "text-status-warning-fg")}>
                      {item.available
                        ? item.models.map((model) => model.id).join(" · ")
                        : item.unavailable_reason || text("Unavailable", "不可用", "利用不可")}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
            <SettingsRow label={text("Devices", "设备", "デバイス")}>
              <ul className="flex flex-wrap gap-2 text-xs">
                {runtime.devices.map((device) => (
                  <li
                    key={device.id}
                    title={device.unavailable_reason ?? undefined}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1",
                      device.available ? "border-border bg-muted text-foreground/85" : "border-status-warning/30 bg-status-warning/10 text-status-warning-fg",
                    )}
                  >
                    <span aria-hidden="true" className={cn("size-1.5 rounded-full", device.available ? "bg-status-success" : "bg-status-warning")} />
                    {deviceName(device.id, text)}
                    {device.name && device.name !== deviceName(device.id, text) ? <span className="text-muted-foreground">{device.name}</span> : null}
                  </li>
                ))}
              </ul>
            </SettingsRow>
            <SettingsRow label={text("Input limits", "输入限制", "入力制限")}>
              <p className="text-[13px] leading-relaxed text-foreground/85">
                {runtime.limits.video_suffixes.join(" / ")}
                <span aria-hidden="true"> · </span>
                {text("Up to", "最大", "上限")} {formatBytes(runtime.limits.max_file_bytes)}
                <span aria-hidden="true"> · </span>
                {text(`${runtime.limits.max_video_duration_ms / 60000} min`, `${runtime.limits.max_video_duration_ms / 60000} 分钟`, `${runtime.limits.max_video_duration_ms / 60000} 分`)}
                <span aria-hidden="true"> · </span>
                {runtime.limits.max_video_width}×{runtime.limits.max_video_height}
              </p>
            </SettingsRow>
          </>
        )}
      </SettingsSection>
    </div>
  )
}
