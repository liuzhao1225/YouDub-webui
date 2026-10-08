"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { ReactNode, useCallback, useEffect, useState } from "react"
import {
  ListVideo,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Settings2,
  Sparkles,
  type LucideIcon,
} from "lucide-react"

import { isAbortError } from "@/lib/api"
import { type UiLanguage, useI18n } from "@/lib/i18n"
import { setSidebarCollapsed } from "@/lib/sidebar"
import { SerialPollingContext, useSerialPolling } from "@/lib/use-serial-polling"
import { cn } from "@/lib/utils"
import { getSettings, listTasks, patchSettings, type TaskSummary } from "@/lib/v1-api"
import { STAGE_LABELS, WAIT_LABELS, useV1Text } from "@/lib/v1-ui"
import { Equalizer } from "@/components/brand/equalizer"
import { LanguageMenuButton, LanguageSwitcher } from "@/components/language-switcher"
import { LogoutButton } from "@/components/logout-button"
import { ThemeToggle } from "@/components/theme-toggle"
import { Button } from "@/components/ui/button"
import { Tooltip } from "@/components/ui/tooltip"

type NavKey = "studio" | "library" | "settings"

const NAV_ITEMS: { key: NavKey; href: string; icon: LucideIcon; match: (pathname: string) => boolean }[] = [
  { key: "studio", href: "/", icon: Sparkles, match: (pathname) => pathname === "/" },
  { key: "library", href: "/tasks", icon: ListVideo, match: (pathname) => pathname.startsWith("/tasks") },
  { key: "settings", href: "/settings", icon: Settings2, match: (pathname) => pathname.startsWith("/settings") },
]

// 只在侧边栏收起时显示的提示（展开时文字标签已可见）。
const COLLAPSED_ONLY_TOOLTIP = "hidden sidebar-collapsed:block"

type QueueState = {
  activeCount: number
  // 进行中的任务超过一页时只显示下限。
  more: boolean
  current: TaskSummary | null
}

const QUEUE_LIMIT = 100

// 侧边栏的全局队列状态，比页面内的列表轮询慢一些。
function useQueueState() {
  const [queue, setQueue] = useState<QueueState | null>(null)
  const poll = useCallback(async ({ signal, isCurrent }: SerialPollingContext) => {
    try {
      const result = await listTasks({ active: true, limit: QUEUE_LIMIT }, signal)
      if (isCurrent()) {
        setQueue({
          activeCount: result.items.length,
          more: result.has_more,
          current: result.items.find((task) => task.status !== "queued") ?? result.items.at(-1) ?? null,
        })
      }
    } catch (err) {
      if (!isAbortError(err) && isCurrent()) setQueue(null)
    }
  }, [])
  useSerialPolling(poll, 5000)
  return queue
}

// 登录后以 v1 Settings 中保存的界面语言为准；切换语言时写回，失败时只在本机生效。
function useUiLanguageSync() {
  const { setLanguage } = useI18n()
  useEffect(() => {
    const controller = new AbortController()
    getSettings(controller.signal).then((settings) => {
      if (!controller.signal.aborted) setLanguage(settings.ui_language)
    }).catch(() => {})
    return () => controller.abort()
  }, [setLanguage])
  return useCallback((next: UiLanguage) => {
    setLanguage(next)
    patchSettings({ ui_language: next }).catch(() => {})
  }, [setLanguage])
}

function countText(queue: QueueState) {
  return `${queue.activeCount}${queue.more ? "+" : ""}`
}

function QueueStatus({ queue }: { queue: QueueState | null }) {
  const { t } = useI18n()
  const text = useV1Text()
  if (!queue) return null
  if (queue.activeCount === 0) {
    return (
      <div className="rounded-xl border border-border bg-muted px-3 py-2.5">
        <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <span className="size-1.5 rounded-full bg-status-neutral" aria-hidden="true" />
          {t.nav.queueIdle}
        </p>
        <p className="mt-1 text-[11px] leading-relaxed text-subtle-foreground">{t.nav.queueIdleHint}</p>
      </div>
    )
  }
  const current = queue.current
  const started = current && current.status !== "queued"
  const progress = started && current.stage_progress !== null ? Math.round(current.stage_progress * 100) : null
  return (
    <Link
      href={current ? `/tasks/${current.id}` : "/tasks"}
      className="group block rounded-xl border border-status-running/25 bg-status-running/10 p-3 transition-colors outline-none hover:bg-status-running/15 focus-visible:ring-3 focus-visible:ring-ring/40"
    >
      <p className="flex items-center justify-between text-xs font-medium text-status-running-fg">
        <span className="flex items-center gap-2">
          <Equalizer className="h-3" />
          {t.nav.processing}
        </span>
        <span className="rounded-full bg-status-running/15 px-1.5 tabular-nums">{countText(queue)}</span>
      </p>
      {current ? (
        <>
          <p className="mt-2 truncate text-[13px] font-medium text-foreground">{current.source_name}</p>
          {started ? (
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-accent">
              <div
                className={cn(
                  "relative h-full overflow-hidden rounded-full bg-brand-gradient transition-[width] duration-500",
                  progress === null && "opacity-50",
                )}
                style={{ width: `${progress ?? 100}%` }}
              >
                {progress === null ? <span className="shimmer absolute inset-0" /> : null}
              </div>
            </div>
          ) : null}
          <p className="mt-1.5 truncate text-[11px] text-muted-foreground">
            {started
              ? [
                text(...STAGE_LABELS[current.current_stage]),
                progress !== null ? `${progress}%` : null,
                current.wait_reason ? text(...WAIT_LABELS[current.wait_reason]) : null,
              ].filter(Boolean).join(" · ")
              : t.nav.queuedOnly}
          </p>
        </>
      ) : null}
    </Link>
  )
}

function QueueStatusCompact({ queue, className }: { queue: QueueState | null; className?: string }) {
  const { t } = useI18n()
  if (!queue) return null
  const active = queue.activeCount > 0
  const current = queue.current
  const label = active
    ? [t.nav.processing, countText(queue), current?.source_name].filter(Boolean).join(" · ")
    : t.nav.queueIdle
  return (
    <Tooltip content={label} side="right">
      <Link
        href={current ? `/tasks/${current.id}` : "/tasks"}
        aria-label={label}
        className={cn(
          "relative size-10 items-center justify-center rounded-xl border transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/40",
          active
            ? "border-status-running/25 bg-status-running/10 text-status-running-fg hover:bg-status-running/15"
            : "border-border bg-muted text-subtle-foreground",
          className,
        )}
      >
        {active ? (
          <Equalizer className="h-3.5" />
        ) : (
          <span className="size-1.5 rounded-full bg-status-neutral" aria-hidden="true" />
        )}
        {active ? (
          <span className="absolute -top-1 -right-1 min-w-4 rounded-full bg-status-running px-1 text-center text-[10px] leading-4 font-semibold text-white tabular-nums">
            {countText(queue)}
          </span>
        ) : null}
      </Link>
    </Tooltip>
  )
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const { t } = useI18n()
  const queue = useQueueState()
  const changeLanguage = useUiLanguageSync()

  return (
    <div className="min-h-screen transition-[padding] duration-200 ease-out lg:pl-[248px] lg:sidebar-collapsed:pl-[72px]">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[248px] flex-col border-r border-border bg-surface transition-[width] duration-200 ease-out lg:flex sidebar-collapsed:w-[72px]">
        <div className="flex h-16 shrink-0 items-center justify-between gap-2 pr-3 pl-5 sidebar-collapsed:justify-center sidebar-collapsed:px-0">
          <Link href="/" className="rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/40">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/youdub-logo.svg" alt="YouDub" className="h-7 w-auto sidebar-collapsed:hidden" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/youdub-icon.svg" alt="YouDub" className="hidden h-[22px] w-auto sidebar-collapsed:block" />
          </Link>
          <Tooltip content={t.nav.collapseSidebar}>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t.nav.collapseSidebar}
              onClick={() => setSidebarCollapsed(true)}
              className="sidebar-collapsed:hidden"
            >
              <PanelLeftClose />
            </Button>
          </Tooltip>
        </div>
        <div className="hidden justify-center pb-3 sidebar-collapsed:flex">
          <Tooltip content={t.nav.expandSidebar} side="right">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t.nav.expandSidebar}
              onClick={() => setSidebarCollapsed(false)}
            >
              <PanelLeftOpen />
            </Button>
          </Tooltip>
        </div>

        <div className="px-3 sidebar-collapsed:flex sidebar-collapsed:justify-center">
          <Tooltip content={t.nav.newTask} side="right" className={COLLAPSED_ONLY_TOOLTIP}>
            <Button
              nativeButton={false}
              render={<Link href="/" />}
              size="lg"
              className="w-full sidebar-collapsed:size-10 sidebar-collapsed:px-0"
            >
              <Plus />
              <span className="sidebar-collapsed:sr-only">{t.nav.newTask}</span>
            </Button>
          </Tooltip>
        </div>

        <nav aria-label={t.nav.primary} className="mt-6 flex flex-col gap-0.5 px-3 sidebar-collapsed:items-center sidebar-collapsed:gap-1">
          {NAV_ITEMS.map((item) => {
            const active = item.match(pathname)
            const Icon = item.icon
            return (
              <Tooltip key={item.key} content={t.nav[item.key]} side="right" className={COLLAPSED_ONLY_TOOLTIP}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative flex h-9 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/40",
                    "sidebar-collapsed:size-10 sidebar-collapsed:justify-center sidebar-collapsed:px-0",
                    active
                      ? "bg-accent text-foreground before:absolute before:top-1/2 before:left-0 before:h-4 before:w-[3px] before:-translate-y-1/2 before:rounded-full before:bg-[linear-gradient(180deg,var(--brand-pink),var(--brand-blue))]"
                      : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                  )}
                >
                  <Icon className={cn("size-4 shrink-0", active ? "text-foreground" : "text-subtle-foreground")} />
                  <span className="sidebar-collapsed:sr-only">{t.nav[item.key]}</span>
                  {item.key === "library" && queue && queue.activeCount > 0 ? (
                    <span className="ml-auto rounded-full bg-status-running/15 px-1.5 text-[11px] font-semibold tabular-nums text-status-running-fg sidebar-collapsed:absolute sidebar-collapsed:-top-1 sidebar-collapsed:-right-1 sidebar-collapsed:ml-0 sidebar-collapsed:min-w-4 sidebar-collapsed:bg-status-running sidebar-collapsed:px-1 sidebar-collapsed:text-center sidebar-collapsed:text-[10px] sidebar-collapsed:leading-4 sidebar-collapsed:text-white">
                      {countText(queue)}
                    </span>
                  ) : null}
                </Link>
              </Tooltip>
            )
          })}
        </nav>

        <div className="mt-auto flex flex-col gap-3 p-3 sidebar-collapsed:items-center">
          <div className="sidebar-collapsed:hidden">
            <QueueStatus queue={queue} />
          </div>
          <QueueStatusCompact queue={queue} className="hidden sidebar-collapsed:flex" />
          <div className="flex items-center gap-1 border-t border-border pt-3 sidebar-collapsed:w-full sidebar-collapsed:flex-col">
            <LanguageSwitcher className="mr-auto sidebar-collapsed:hidden" onChange={changeLanguage} />
            <LanguageMenuButton className="hidden sidebar-collapsed:inline-flex" onChange={changeLanguage} />
            <ThemeToggle />
            <LogoutButton />
          </div>
        </div>
      </aside>

      <header className="glass sticky top-0 z-40 flex h-14 items-center justify-between gap-3 border-b border-border px-4 lg:hidden">
        <Link href="/" className="rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/40">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/youdub-logo.svg" alt="YouDub" className="h-6 w-auto" />
        </Link>
        <div className="flex items-center gap-1">
          <LanguageSwitcher onChange={changeLanguage} />
          <ThemeToggle />
          <LogoutButton />
        </div>
      </header>

      <main className="relative pb-24 lg:pb-0">{children}</main>

      <nav
        aria-label={t.nav.primary}
        className="glass fixed inset-x-0 bottom-0 z-40 grid grid-cols-3 border-t border-border pb-[env(safe-area-inset-bottom)] lg:hidden"
      >
        {NAV_ITEMS.map((item) => {
          const active = item.match(pathname)
          const Icon = item.icon
          return (
            <Link
              key={item.key}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex flex-col items-center gap-1 pt-2.5 pb-2 text-[11px] font-medium outline-none",
                active ? "text-foreground" : "text-subtle-foreground",
              )}
            >
              {active ? (
                <span aria-hidden="true" className="absolute top-0 h-0.5 w-8 rounded-full bg-brand-gradient" />
              ) : null}
              <Icon className="size-5" />
              {t.nav[item.key]}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
