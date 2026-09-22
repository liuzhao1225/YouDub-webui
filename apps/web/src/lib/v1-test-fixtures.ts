import type { Runtime, Settings, Task, TaskConfig } from "@/lib/v1-api"

// Test-only provider catalogue; no test adapter is advertised by production UI.
export const testConfig: TaskConfig = {
  source_language: "en", target_language: "zh", output_mode: "subtitles", keep_background: false,
  asr: { adapter: "test_asr", model: "asr", device: "cpu" },
  translation: { adapter: "test_translation", model: "translation", device: "remote" },
  tts: null, separation: null,
}

export function testSettings(): Settings {
  return { defaults: testConfig, ui_language: "zh", connections: [{ adapter: "test_translation", base_url: "https://example.com/v1", has_api_key: true }] }
}

export function testRuntime(): Runtime {
  return {
    api_version: "v1", contract_version: "test", instance_id: "d1b8b5af-55a1-47ac-8a81-0be8d74c5cb0",
    status: "ready", platform: "macos", arch: "arm64",
    devices: [{ id: "cpu", name: "CPU", available: true, unavailable_reason: null }],
    capabilities: (["asr", "translation", "tts", "separation"] as const).map((kind) => ({
      adapter: `test_${kind}`, capability: kind, execution: kind === "translation" ? "remote" : "local",
      available: true, unavailable_reason: null, requires_api_key: kind === "translation", data_sent: kind === "translation" ? ["text"] : [],
      remote_operations: kind === "translation" ? { submit_mode: "sync", can_poll: false, can_cancel: false, can_lookup_request_key: false } : null,
      models: [{ id: kind, devices: [kind === "translation" ? "remote" : "cpu"], source_languages: ["en", "zh", "ja", "auto"], target_languages: ["en", "zh", "ja"],
        voice_modes: kind === "tts" ? ["preset", "source_clone"] : [], voices: kind === "tts" ? [{ id: "voice", name: "测试声音", languages: ["en", "zh", "ja"] }] : [],
        input_limits: { max_audio_duration_ms: null, max_text_chars: null, max_reference_duration_ms: null },
      }],
    })),
    limits: { max_file_bytes: 104857600, max_video_duration_ms: 600000, max_video_width: 1920, max_video_height: 1920, max_frame_rate: 60,
      video_suffixes: [".mp4", ".mov"], video_codecs: ["h264"], audio_codecs: ["aac"], max_active_tasks: 1, cpu_heavy_slots: 1,
      gpu_slots_per_device: 1, remote_request_slots_per_connection: 1, remote_pending_slots_per_connection: 1, poll_interval_ms: 2000 },
  }
}

export function testTask(patch: Partial<Task> = {}): Task {
  return {
    id: "8d129c98-8e49-4afb-af3a-0b4da4a5533f", attempt: 1, source_name: "示例.mp4", source_size_bytes: 4096, source_duration_ms: 12000,
    status: "queued", current_stage: "prepare", stage_progress: null, wait_reason: null, message: null, error: null,
    external_operation: { state: "none", may_still_run: false }, allowed_actions: ["cancel"],
    created_at: "2026-09-22T10:00:00.000Z", updated_at: "2026-09-22T10:00:00.000Z", started_at: null, finished_at: null,
    config: testConfig, pipeline_version: "test", resolved_connections: [], outputs: {}, ...patch,
  }
}

export function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

export function readBlob(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsText(blob)
  })
}
