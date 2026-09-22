import { useState } from "react"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { configProblem, initialTaskConfig, TaskConfigForm } from "@/components/v1-task-config"
import { LanguageProvider } from "@/lib/i18n"
import type { Runtime, TaskConfig } from "@/lib/v1-api"
import { testConfig, testRuntime, testSettings } from "@/lib/v1-test-fixtures"

function runtimeWithVoxCpm() {
  const runtime = testRuntime()
  const tts = runtime.capabilities.find((item) => item.capability === "tts")!
  runtime.capabilities.push({ ...tts, adapter: "voxcpm", models: [{ ...tts.models[0], id: "VoxCPM2" }] })
  return runtime
}

const qwenSelection = { adapter: "qwen_forced_aligner", model: "Qwen3-ForcedAligner-0.6B-hf", device: "cpu" } as const

function runtimeWithQwen() {
  const runtime = testRuntime()
  const base = runtime.capabilities.find((item) => item.capability === "separation")!
  runtime.capabilities.push({ ...base, adapter: qwenSelection.adapter, capability: "subtitle_alignment", models: [{
    ...base.models[0], id: qwenSelection.model, source_languages: [], target_languages: ["en", "zh"],
    input_limits: { max_audio_duration_ms: 300000, max_text_chars: null, max_reference_duration_ms: null },
  }] })
  return runtime
}

function mount(runtime: Runtime, initial: TaskConfig = testConfig) {
  const onChange = vi.fn()
  function Form() {
    const [value, setValue] = useState(initial)
    return <TaskConfigForm runtime={runtime} value={value} onChange={(next) => { setValue(next); onChange(next) }} />
  }
  render(<LanguageProvider><Form /></LanguageProvider>)
  return onChange
}

afterEach(() => { cleanup(); window.localStorage.clear() })

describe("v1 任务配置", () => {
  it("仅配音和字幕模式显示 Qwen 时间选择，退出该模式清除选择", async () => {
    const runtime = runtimeWithQwen()
    const onChange = mount(runtime)
    const user = userEvent.setup()
    expect(screen.queryByLabelText("字幕时间")).not.toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText("输出内容"), "both")
    expect(screen.getByLabelText("字幕时间")).toHaveValue("")
    await user.selectOptions(screen.getByLabelText("字幕时间"), JSON.stringify(Object.values(qwenSelection)))
    const config = onChange.mock.calls.at(-1)![0]
    expect(config.subtitle_alignment).toEqual(qwenSelection)
    expect(configProblem(config, runtime, testSettings(), (en, zh) => zh)).toBeNull()
    await user.selectOptions(screen.getByLabelText("输出内容"), "subtitles")
    expect(onChange.mock.calls.at(-1)![0]).toMatchObject({ tts: null, subtitle_alignment: null })
    expect(screen.queryByLabelText("字幕时间")).not.toBeInTheDocument()
  })

  it("保存的字幕时间选择保持原值，目标语言不支持时显式提示", async () => {
    const runtime = runtimeWithQwen()
    const defaults: TaskConfig = { ...testConfig, output_mode: "both", subtitle_alignment: qwenSelection,
      tts: { adapter: "test_tts", model: "tts", device: "cpu", voice: { mode: "preset", id: "voice" } } }
    expect(initialTaskConfig(runtime, { ...testSettings(), defaults })).toEqual(defaults)
    const onChange = mount(runtime, defaults)
    expect(screen.getByLabelText("字幕时间")).toHaveValue(JSON.stringify(Object.values(qwenSelection)))
    await userEvent.setup().selectOptions(screen.getByLabelText("目标语言"), "ja")
    const config = onChange.mock.calls.at(-1)![0]
    expect(config.subtitle_alignment).toEqual(qwenSelection)
    expect(configProblem(config, runtime, testSettings(), (en, zh) => zh)).toContain("模型支持")
  })

  it("可选 Qwen 不可用时允许原配置，已选择 Qwen 时提示模型不可用", () => {
    const runtime = runtimeWithQwen()
    runtime.capabilities.at(-1)!.available = false
    runtime.capabilities.at(-1)!.unavailable_reason = "未安装模型"
    expect(configProblem(testConfig, runtime, testSettings(), (en, zh) => zh)).toBeNull()
    const defaults: TaskConfig = { ...testConfig, output_mode: "both", subtitle_alignment: qwenSelection,
      tts: { adapter: "test_tts", model: "tts", device: "cpu", voice: { mode: "preset", id: "voice" } } }
    expect(configProblem(defaults, runtime, testSettings(), (en, zh) => zh)).toContain("可用模型")
    mount(runtime, defaults)
    expect(screen.getByRole("option", { name: "Qwen — 未安装模型" })).toBeDisabled()
    expect(screen.getByLabelText("字幕时间")).toHaveValue(JSON.stringify(Object.values(qwenSelection)))
  })

  it("专名提示默认留空，切换识别模型和输出后保留，允许清空", async () => {
    const runtime = testRuntime()
    runtime.capabilities[0].models.push({ ...runtime.capabilities[0].models[0], id: "second-asr" })
    const onChange = mount(runtime)
    const user = userEvent.setup()
    const hint = screen.getByLabelText("专名提示（可选）")
    expect(hint).toHaveValue("")
    expect(hint).toHaveAttribute("maxlength", "500")
    expect(hint).toHaveAccessibleDescription("填写人名、品牌名，帮助语音识别。最多 500 字。")
    await user.type(hint, "YouDub, 张三")
    await user.selectOptions(screen.getByLabelText("语音识别模型"), JSON.stringify(["test_asr", "second-asr", "cpu"]))
    await user.selectOptions(screen.getByLabelText("输出内容"), "both")
    expect(onChange.mock.calls.at(-1)![0].asr).toEqual({ adapter: "test_asr", model: "second-asr", device: "cpu", initial_prompt: "YouDub, 张三" })
    expect(hint).toHaveValue("YouDub, 张三")
    await user.clear(hint)
    expect(onChange.mock.calls.at(-1)![0].asr.initial_prompt).toBeNull()
  })

  it("提示达到 500 字时不接受更多输入", async () => {
    mount(testRuntime(), { ...testConfig, asr: { ...testConfig.asr, initial_prompt: "名".repeat(500) } })
    const user = userEvent.setup()
    const hint = screen.getByLabelText("专名提示（可选）")
    await user.type(hint, "字")
    expect(hint).toHaveValue("名".repeat(500))
  })

  it("无默认配置仍默认输出字幕，首次启用配音优先可用 VoxCPM2 源音色克隆", async () => {
    const runtime = runtimeWithVoxCpm()
    const initial = initialTaskConfig(runtime, { ...testSettings(), defaults: null })
    expect(initial.output_mode).toBe("subtitles")
    expect(initial.asr).not.toHaveProperty("initial_prompt")
    const onChange = mount(runtime, initial)
    await userEvent.setup().selectOptions(screen.getByLabelText("输出内容"), "both")
    expect(onChange.mock.calls.at(-1)![0]).toMatchObject({
      tts: { adapter: "voxcpm", model: "VoxCPM2", device: "cpu", voice: { mode: "source_clone" } },
      separation: { adapter: "test_separation", model: "separation", device: "cpu" },
    })
    expect(screen.getByLabelText("声音方式")).toHaveValue("source_clone")
  })

  it.each(["unavailable", "no-clone", "unsupported-language", "unavailable-device"])("VoxCPM2 %s 时保留现有可用模型选择", async (reason) => {
    const runtime = runtimeWithVoxCpm()
    const voxcpm = runtime.capabilities.at(-1)!
    if (reason === "unavailable") voxcpm.available = false
    if (reason === "no-clone") voxcpm.models[0].voice_modes = ["preset"]
    if (reason === "unsupported-language") voxcpm.models[0].target_languages = ["ja"]
    if (reason === "unavailable-device") voxcpm.models[0].devices = ["cuda:0"]
    const onChange = mount(runtime)
    await userEvent.setup().selectOptions(screen.getByLabelText("输出内容"), "dubbing")
    expect(onChange.mock.calls.at(-1)![0].tts).toEqual({ adapter: "test_tts", model: "tts", device: "cpu", voice: { mode: "preset", id: "voice" } })
  })

  it("尊重已保存的提示和预设声音，显式换 VoxCPM2 时选择源音色克隆", async () => {
    const runtime = runtimeWithVoxCpm()
    const defaults: TaskConfig = {
      ...testConfig, output_mode: "dubbing", asr: { ...testConfig.asr, initial_prompt: "Saved name" },
      tts: { adapter: "test_tts", model: "tts", device: "cpu", voice: { mode: "preset", id: "voice" } },
    }
    const initial = initialTaskConfig(runtime, { ...testSettings(), defaults })
    expect(initial).toEqual(defaults)
    const onChange = mount(runtime, initial)
    const user = userEvent.setup()
    expect(screen.getByLabelText("专名提示（可选）")).toHaveValue("Saved name")
    expect(screen.getByLabelText("声音方式")).toHaveValue("preset")
    await user.selectOptions(screen.getByLabelText("目标语言"), "ja")
    expect(onChange.mock.calls.at(-1)![0].tts).toEqual(defaults.tts)
    await user.selectOptions(screen.getByLabelText("配音模型"), JSON.stringify(["voxcpm", "VoxCPM2", "cpu"]))
    expect(onChange.mock.calls.at(-1)![0].tts).toEqual({ adapter: "voxcpm", model: "VoxCPM2", device: "cpu", voice: { mode: "source_clone" } })
  })
})
