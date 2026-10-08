import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { V1SettingsForm } from "@/components/v1-settings-form"
import { LanguageProvider } from "@/lib/i18n"
import { ThemeProvider } from "@/lib/theme"
import { jsonResponse, testRuntime, testSettings } from "@/lib/v1-test-fixtures"

const fetchMock = vi.fn<typeof fetch>()
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock) })
afterEach(() => { cleanup(); window.localStorage.clear(); vi.unstubAllGlobals() })

function mount() {
  render(<LanguageProvider><ThemeProvider><V1SettingsForm /></ThemeProvider></LanguageProvider>)
}

function patchBodies() {
  return fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH").map(([, init]) => JSON.parse(String(init?.body)))
}

describe("v1 设置", () => {
  it("不回显已存密钥，留空保留、显式清除使用 null", async () => {
    fetchMock.mockImplementation(async (input, init) => String(input) === "/api/v1/runtime" ? jsonResponse(testRuntime()) : jsonResponse({ ...testSettings(), connections: [{ ...testSettings().connections[0], has_api_key: init?.method === "PATCH" ? !Object.hasOwn(JSON.parse(String(init.body)).connection, "api_key") : true }] }))
    mount()
    const user = userEvent.setup()
    const key = await screen.findByLabelText("API Key")
    expect(key).toHaveValue("")
    expect(key).toHaveAttribute("type", "password")
    expect(key.getAttribute("placeholder")).toMatch(/^•+$/)
    expect(screen.getByRole("button", { name: "显示 API Key" })).toBeDisabled()
    await user.click(screen.getByRole("button", { name: "保存连接" }))
    expect(await screen.findByText("连接已保存。")).toBeInTheDocument()
    expect(patchBodies()[0]).toEqual({ connection: { adapter: "test_translation", base_url: "https://example.com/v1" } })
    await user.click(screen.getByRole("button", { name: "清除已保存的密钥" }))
    expect(screen.getByText("保存后将清除已保存的密钥。")).toBeInTheDocument()
    expect(key).not.toHaveAttribute("placeholder")
    await user.click(screen.getByRole("button", { name: "保存连接" }))
    await waitFor(() => expect(patchBodies()).toHaveLength(2))
    expect(patchBodies()[1]).toEqual({ connection: { adapter: "test_translation", base_url: "https://example.com/v1", api_key: null } })
    expect(await screen.findByText("尚未保存密钥。")).toBeInTheDocument()
  })

  it("新输入的密钥可以显示原文，保存后输入框清空", async () => {
    fetchMock.mockImplementation(async (input) => String(input) === "/api/v1/runtime" ? jsonResponse(testRuntime()) : jsonResponse(testSettings()))
    mount()
    const user = userEvent.setup()
    const key = await screen.findByLabelText("API Key")
    await user.type(key, "sk-new-value")
    await user.click(screen.getByRole("button", { name: "显示 API Key" }))
    expect(key).toHaveAttribute("type", "text")
    expect(key).toHaveValue("sk-new-value")
    await user.click(screen.getByRole("button", { name: "保存连接" }))
    await waitFor(() => expect(key).toHaveValue(""))
    expect(patchBodies()[0]).toEqual({ connection: { adapter: "test_translation", base_url: "https://example.com/v1", api_key: "sk-new-value" } })
    expect(key).toHaveAttribute("type", "password")
  })

  it("更换服务地址且未填新密钥时提示旧密钥会被移除", async () => {
    fetchMock.mockImplementation(async (input) => String(input) === "/api/v1/runtime" ? jsonResponse(testRuntime()) : jsonResponse(testSettings()))
    mount()
    const user = userEvent.setup()
    const url = await screen.findByLabelText("服务地址")
    await user.clear(url)
    await user.type(url, "https://other.example.com/v1")
    expect(screen.getByText(/已保存的密钥不会发往新地址/)).toBeInTheDocument()
    expect(screen.getByLabelText("API Key")).toHaveAttribute("aria-invalid", "true")
    expect(screen.getByLabelText("API Key")).not.toHaveAttribute("placeholder")
  })

  it("密钥部分写入时读回实际设置并保留错误", async () => {
    let reads = 0
    fetchMock.mockImplementation(async (input, init) => {
      if (String(input) === "/api/v1/runtime") return jsonResponse(testRuntime())
      if (init?.method === "PATCH") return jsonResponse({ error: { code: "SETTINGS_PARTIALLY_APPLIED", message: "新密钥已保存，旧密钥未能移除", field: "connection", stage: null, action: "contact_support" } }, 500)
      reads += 1
      return jsonResponse({ ...testSettings(), connections: [{ ...testSettings().connections[0], has_api_key: reads === 1 }] })
    })
    mount()
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText("API Key"), "sk-partial")
    await user.click(screen.getByRole("button", { name: "保存连接" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("新密钥已保存，旧密钥未能移除")
    expect(reads).toBe(2)
    expect(await screen.findByText("尚未保存密钥。")).toBeInTheDocument()
  })

  it("界面语言单独保存到 Settings 并更新日语界面", async () => {
    fetchMock.mockImplementation(async (input, init) => {
      if (String(input) === "/api/v1/runtime") return jsonResponse(testRuntime())
      return jsonResponse({ ...testSettings(), ...(init?.method === "PATCH" ? JSON.parse(String(init.body)) : {}) })
    })
    mount()
    const user = userEvent.setup()
    await screen.findByLabelText("API Key")
    await user.click(screen.getByRole("button", { name: "日本語" }))
    expect(await screen.findByRole("button", { name: "接続を保存" })).toBeInTheDocument()
    expect(await screen.findByText("表示言語を保存しました。")).toBeInTheDocument()
    expect(document.documentElement.lang).toBe("ja")
    expect(window.localStorage.getItem("youdub-ui-language")).toBe("ja")
    expect(patchBodies()).toEqual([{ ui_language: "ja" }])
  })

  it("列出运行环境，不可用的模型显示原因，不重复展示默认配置", async () => {
    const runtime = testRuntime()
    runtime.capabilities[2].available = false
    runtime.capabilities[2].unavailable_reason = "本机未安装 VoxCPM2 权重"
    fetchMock.mockImplementation(async (input) => String(input) === "/api/v1/runtime" ? jsonResponse(runtime) : jsonResponse(testSettings()))
    mount()
    expect(await screen.findByText("本机未安装 VoxCPM2 权重")).toBeInTheDocument()
    expect(screen.getByRole("list", { name: "模型可用性" })).toHaveTextContent("test_asr")
    expect(screen.queryByRole("heading", { name: "新任务默认配置" })).not.toBeInTheDocument()
  })
})
