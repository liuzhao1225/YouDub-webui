// Fields consumed by the official localize editor from its workflow config,
// provider catalog, and runtime device inventory.
export type ModelSelection = {
  adapter: string
  model: string
  device: "cpu" | `cuda:${number}` | "remote"
}

export type TtsSelection = ModelSelection & {
  voice: { mode: "preset"; id: string } | { mode: "source_clone" }
}

export type TaskConfig = {
  source_language: string
  target_language: string
  output_mode: "subtitles" | "dubbing" | "both"
  keep_background: boolean
  asr: ModelSelection & { initial_prompt?: string | null }
  translation: ModelSelection
  tts: TtsSelection | null
  separation: ModelSelection | null
  subtitle_alignment?: ModelSelection | null
}

export type ModelCapability = {
  id: string
  devices: string[]
  source_languages: string[]
  target_languages: string[]
  voice_modes: ("preset" | "source_clone")[]
  voices: { id: string; name: string; languages: string[] }[]
}

export type Capability = {
  adapter: string
  capability: "separation" | "asr" | "translation" | "tts" | "subtitle_alignment"
  execution: "local" | "remote"
  available: boolean
  unavailable_reason: string | null
  models: ModelCapability[]
}

export type Runtime = {
  devices: { id: string; available: boolean }[]
  capabilities: Capability[]
}
