import { cleanup, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AppShell } from "@/components/app-shell"
import { LanguageProvider } from "@/lib/i18n"
import { ThemeProvider } from "@/lib/theme"
import { jsonResponse, testSettings, testTask } from "@/lib/v1-test-fixtures"

const mocks = vi.hoisted(() => ({ fetch: vi.fn<typeof fetch>() }))
vi.mock("next/navigation", () => ({ usePathname: () => "/" }))
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ logout: vi.fn() }) }))

function mount() {
  render(<LanguageProvider><ThemeProvider><AppShell><p>内容</p></AppShell></ThemeProvider></LanguageProvider>)
}

const running = testTask({ id: "4ddc069a-a889-4b78-9cc4-1f558875c370", source_name: "正在处理.mp4", status: "running", current_stage: "translate", stage_progress: 0.5 })
const queued = testTask({ source_name: "排队中.mp4", status: "queued", wait_reason: "active_limit" })

beforeEach(() => {
  mocks.fetch.mockReset()
  mocks.fetch.mockImplementation(async (input, init) => {
    const path = String(input)
    if (path === "/api/v1/settings" && init?.method === "PATCH") return jsonResponse({ ...testSettings(), ...JSON.parse(String(init.body)) })
    if (path === "/api/v1/settings") return jsonResponse({ ...testSettings(), ui_language: "en" })
    if (path === "/api/v1/tasks?active=true&limit=100") return jsonResponse({ items: [queued, running], limit: 100, offset: 0, has_more: false })
    throw new Error(`Unexpected request: ${path}`)
  })
  vi.stubGlobal("fetch", mocks.fetch)
})
afterEach(() => { cleanup(); window.localStorage.clear(); vi.unstubAllGlobals() })

describe("应用外壳", () => {
  it("登录后按 Settings 中的界面语言显示，并展示正在处理的任务", async () => {
    mount()
    const nav = await screen.findAllByRole("navigation", { name: "Main navigation" })
    expect(within(nav[0]).getByRole("link", { name: "Studio" })).toHaveAttribute("aria-current", "page")
    // 展开与收起的侧边栏各有一张队列卡片，都指向正在处理的任务。
    const cards = await screen.findAllByRole("link", { name: /正在处理\.mp4/ })
    expect(cards.map((card) => card.getAttribute("href"))).toEqual([`/tasks/${running.id}`, `/tasks/${running.id}`])
    expect(cards[0]).toHaveTextContent("Translate · 50%")
    expect(cards[0]).toHaveTextContent("2")
  })

  it("侧边栏切换语言时写回 Settings", async () => {
    mount()
    await screen.findAllByRole("navigation", { name: "Main navigation" })
    const user = userEvent.setup()
    await user.click(screen.getAllByRole("button", { name: "日本語" })[0])
    expect((await screen.findAllByRole("link", { name: "スタジオ" })).length).toBeGreaterThan(0)
    await waitFor(() => expect(mocks.fetch.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(true))
    const [, init] = mocks.fetch.mock.calls.find(([, init]) => init?.method === "PATCH")!
    expect(JSON.parse(String(init?.body))).toEqual({ ui_language: "ja" })
    expect(window.localStorage.getItem("youdub-ui-language")).toBe("ja")
  })
})
