import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { V1SettingsDialog } from "@/components/v1-settings-dialog"
import { LanguageProvider } from "@/lib/i18n"
import { jsonResponse, testRuntime, testSettings } from "@/lib/v1-test-fixtures"

const fetchMock = vi.fn<typeof fetch>()
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock) })
afterEach(() => { cleanup(); window.localStorage.clear(); vi.unstubAllGlobals() })

function mount(onSaved = vi.fn()) {
  render(<LanguageProvider><V1SettingsDialog onSaved={onSaved} /></LanguageProvider>)
}

describe("v1 设置", () => {
  it("不回显已存密钥，留空保留、显式清除使用 null", async () => {
    const saved = vi.fn()
    fetchMock.mockImplementation(async (input, init) => String(input) === "/api/v1/runtime" ? jsonResponse(testRuntime()) : jsonResponse({ ...testSettings(), connections: [{ ...testSettings().connections[0], has_api_key: init?.method === "PATCH" ? !Object.hasOwn(JSON.parse(String(init.body)).connection, "api_key") : true }] }))
    mount(saved)
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "设置" }))
    const key = await screen.findByLabelText("API Key")
    expect(key).toHaveValue("")
    expect(key).toHaveAttribute("type", "password")
    await user.click(screen.getByRole("button", { name: "保存连接" }))
    await waitFor(() => expect(saved).toHaveBeenCalledTimes(1))
    const first = fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH")[0][1]
    expect(JSON.parse(String(first?.body))).toEqual({ connection: { adapter: "test_translation", base_url: "https://example.com/v1" } })
    await user.click(screen.getByLabelText("清除已保存的密钥"))
    await user.click(screen.getByRole("button", { name: "保存连接" }))
    await waitFor(() => expect(saved).toHaveBeenCalledTimes(2))
    const second = fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH")[1][1]
    expect(JSON.parse(String(second?.body))).toEqual({ connection: { adapter: "test_translation", base_url: "https://example.com/v1", api_key: null } })
    expect(await screen.findByText("尚未保存密钥。")).toBeInTheDocument()
  })

  it("界面语言单独保存到 Settings 并更新日语界面", async () => {
    fetchMock.mockImplementation(async (input, init) => {
      if (String(input) === "/api/v1/runtime") return jsonResponse(testRuntime())
      return jsonResponse({ ...testSettings(), ...(init?.method === "PATCH" ? JSON.parse(String(init.body)) : {}) })
    })
    mount()
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "设置" }))
    await user.selectOptions(await screen.findByLabelText("界面语言"), "ja")
    await user.click(screen.getByRole("button", { name: "保存语言" }))
    expect(await screen.findByRole("button", { name: "接続を保存" })).toBeInTheDocument()
    expect(document.documentElement.lang).toBe("ja")
    expect(window.localStorage.getItem("youdub-ui-language")).toBe("ja")
    expect(JSON.parse(String(fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH")![1]?.body))).toEqual({ ui_language: "ja" })
  })
})
