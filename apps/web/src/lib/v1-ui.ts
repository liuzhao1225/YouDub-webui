"use client"

import { useCallback } from "react"
import { useI18n } from "@/lib/i18n"
import type { OutputMode, Stage, TaskStatus, WaitReason } from "@/lib/v1-api"

export function useV1Text() {
  const { language } = useI18n()
  return useCallback((en: string, zh: string, ja: string) => (
    language === "zh" ? zh : language === "ja" ? ja : en
  ), [language])
}

export type V1Text = ReturnType<typeof useV1Text>
export const STAGES: Stage[] = ["prepare", "separate", "asr", "translate", "tts", "mix", "export"]
export const STATUS_LABELS: Record<TaskStatus, [string, string, string]> = {
  queued: ["Queued", "排队中", "順番待ち"],
  running: ["Running", "处理中", "処理中"],
  waiting: ["Waiting for provider", "等待远端结果", "サービスの結果待ち"],
  cancelling: ["Stopping", "停止中", "停止中"],
  cancelled: ["Cancelled", "已取消", "キャンセル済み"],
  succeeded: ["Completed", "已完成", "完了"],
  failed: ["Failed", "失败", "失敗"],
}
export const STAGE_LABELS: Record<Stage | "done", [string, string, string]> = {
  prepare: ["Prepare", "准备视频", "動画準備"],
  separate: ["Separate audio", "分离人声", "音声分離"],
  asr: ["Transcribe", "语音识别", "文字起こし"],
  translate: ["Translate", "翻译", "翻訳"],
  tts: ["Dub", "生成配音", "吹き替え生成"],
  mix: ["Mix audio", "混音", "音声ミックス"],
  export: ["Export", "导出", "書き出し"],
  done: ["Complete", "已完成", "完了"],
}
export const OUTPUT_LABELS: Record<OutputMode, [string, string, string]> = {
  subtitles: ["Subtitles · original audio", "字幕 · 保留原声", "字幕 · 元の音声"],
  dubbing: ["Dubbing", "配音", "吹き替え"],
  both: ["Dubbing and subtitles", "配音与字幕", "吹き替えと字幕"],
}
export const WAIT_LABELS: Record<WaitReason, [string, string, string]> = {
  active_limit: ["Waiting for the previous task", "等待前一个任务完成", "前のタスクの完了待ち"],
  cpu: ["Waiting for CPU", "等待 CPU", "CPU の空き待ち"],
  gpu: ["Waiting for GPU", "等待 GPU", "GPU の空き待ち"],
  remote_limit: ["Waiting for provider capacity", "等待远端处理名额", "外部サービスの空き待ち"],
  remote_result: ["Waiting for provider result", "等待远端处理结果", "外部サービスの結果待ち"],
}

// 尚未进入终态的任务；列表里用来统计进行中的数量。
export const ACTIVE_STATUSES: readonly TaskStatus[] = ["queued", "running", "waiting", "cancelling"]

export function isActiveStatus(status: TaskStatus) {
  return ACTIVE_STATUSES.includes(status)
}

const LANGUAGE_NAMES: Record<string, string> = { en: "English", zh: "中文", ja: "日本語" }

export function languageName(code: string, text: V1Text) {
  if (code === "auto") return text("Auto detect", "自动识别", "自動検出")
  return LANGUAGE_NAMES[code] ?? code
}

export function deviceName(device: string, text: V1Text) {
  if (device === "cpu") return "CPU"
  if (device === "remote") return text("Remote", "远端", "リモート")
  return device.replace(/^cuda:/, "CUDA ")
}
