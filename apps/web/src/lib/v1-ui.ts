"use client"

import { useCallback } from "react"
import { useI18n } from "@/lib/i18n"
import type { OutputMode, Stage, TaskStatus } from "@/lib/v1-api"

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

export function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
}

export const selectClass = "h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
