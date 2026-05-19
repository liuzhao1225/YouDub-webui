"use client"

import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from "react"

export type UiLanguage = "en" | "zh"

const STORAGE_KEY = "youdub-ui-language"

export const LANGUAGE_OPTIONS: { value: UiLanguage; label: string }[] = [
  { value: "en", label: "English" },
  { value: "zh", label: "中文" },
]

type Messages = {
  common: {
    back: string
    cancel: string
    close: string
    loading: string
    sentenceEnd: string
    waiting: string
  }
  home: Record<string, string>
  task: Record<string, string>
  settings: Record<string, string>
  status: Record<string, string>
  stages: Record<string, string>
}

const messages: Record<UiLanguage, Messages> = {
  en: {
    common: {
      back: "Back",
      cancel: "Cancel",
      close: "Close",
      loading: "loading",
      sentenceEnd: ".",
      waiting: "Waiting",
    },
    home: {
      createTitle: "Create new task",
      youtubeLabel: "YouTube URL (English -> Chinese)",
      bilibiliLabel: "Bilibili URL (Chinese -> English)",
      localVideoLabel: "Local video file",
      localDirectionLabel: "Translation direction",
      localEnZh: "English -> Chinese",
      localZhEn: "Chinese -> English",
      submitting: "Submitting",
      createTask: "Create task",
      taskHistory: "Task history",
      empty: "No tasks yet. Submit a URL or upload a local video above to start.",
      loadError: "Failed to load tasks",
      createError: "Failed to create task",
    },
    task: {
      overview: "Task overview",
      title: "Title",
      taskId: "Task ID",
      created: "Created",
      started: "Started",
      completed: "Completed",
      session: "Session",
      loading: "Loading task...",
      finalVideo: "Final video",
      download: "Download",
      stages: "Stages",
      resumeHelp: "Resume from the failed stage. Already-succeeded stages will be reused from cache.",
      resuming: "Resuming",
      resumeTask: "Resume task",
      runLog: "Run log",
      emptyLog: "Logs will appear once the task starts.",
      dangerZone: "Danger zone",
      rerunHelp: "Wipe the session directory and run this URL again from scratch.",
      rerunTask: "Rerun task",
      rerunTitle: "Rerun this task?",
      rerunDescription:
        "Existing log, session directory and final video will be deleted, then the same URL is re-queued under the same task id.",
      rerunning: "Rerunning",
      confirmRerun: "Confirm rerun",
      deleteHelp:
        "Delete this task, its run log, and the entire session directory under",
      deleteTask: "Delete task",
      deleteTitle: "Delete this task?",
      deleteDescription:
        "This permanently removes the task record, its log file, and the entire session directory. This action cannot be undone.",
      deleting: "Deleting",
      confirmDelete: "Confirm delete",
      runningLocked: "Running tasks cannot be rerun or deleted. Wait until it finishes or fails.",
      loadError: "Failed to load task",
      deleteError: "Failed to delete task",
      rerunError: "Failed to rerun task",
      resumeError: "Failed to resume task",
    },
    settings: {
      button: "Settings",
      title: "Runtime settings",
      description: "Stored locally by the FastAPI backend.",
      language: "Interface language",
      cookie: "YouTube cookie",
      savedCookie: "******** saved YouTube cookie ********",
      cookiePlaceholder: "Paste Netscape cookie content",
      proxyPort: "yt-dlp proxy port",
      baseUrl: "OpenAI base URL",
      apiKey: "OpenAI API key",
      apiKeyPlaceholder: "Leave blank to keep existing key",
      hideApiKey: "Hide API key",
      showApiKey: "Show API key",
      model: "Model",
      selectModel: "Select model",
      loading: "Loading",
      getModels: "Get models",
      translateConcurrency: "Translate concurrency",
      concurrencyHelp: "Parallel OpenAI requests during the translate stage. Increase if your provider allows it.",
      save: "Save settings",
      keySaved: "OpenAI key is saved.",
      saved: "Settings saved.",
      saveError: "Failed to save settings",
      noModels: "No models returned.",
      loadModelsError: "Failed to load models",
    },
    status: {
      queued: "queued",
      running: "running",
      succeeded: "succeeded",
      failed: "failed",
      pending: "pending",
    },
    stages: {
      download: "Download",
      separate: "Demucs",
      asr: "Whisper",
      asr_fix: "Split sentences",
      translate: "Translate",
      split_audio: "Split audio",
      tts: "VoxCPM",
      merge_audio: "Merge audio",
      merge_video: "Merge video",
      done: "Done",
    },
  },
  zh: {
    common: {
      back: "返回",
      cancel: "取消",
      close: "关闭",
      loading: "加载中",
      sentenceEnd: "。",
      waiting: "等待中",
    },
    home: {
      createTitle: "新建任务",
      youtubeLabel: "YouTube 链接（英文 -> 中文）",
      bilibiliLabel: "Bilibili 链接（中文 -> 英文）",
      localVideoLabel: "本地视频文件",
      localDirectionLabel: "翻译方向",
      localEnZh: "英文 -> 中文",
      localZhEn: "中文 -> 英文",
      submitting: "提交中",
      createTask: "创建任务",
      taskHistory: "任务历史",
      empty: "暂无任务。输入链接或上传本地视频后即可开始。",
      loadError: "加载任务失败",
      createError: "创建任务失败",
    },
    task: {
      overview: "任务概览",
      title: "标题",
      taskId: "任务 ID",
      created: "创建时间",
      started: "开始时间",
      completed: "完成时间",
      session: "会话目录",
      loading: "正在加载任务...",
      finalVideo: "最终视频",
      download: "下载",
      stages: "处理阶段",
      resumeHelp: "从失败阶段继续执行。已经成功的阶段会复用缓存结果。",
      resuming: "继续中",
      resumeTask: "继续任务",
      runLog: "运行日志",
      emptyLog: "任务开始后会显示日志。",
      dangerZone: "危险操作",
      rerunHelp: "清空会话目录，并从头重新运行这个链接。",
      rerunTask: "重跑任务",
      rerunTitle: "确认重跑这个任务？",
      rerunDescription:
        "现有日志、会话目录和最终视频会被删除，然后使用同一个任务 ID 重新排队处理相同链接。",
      rerunning: "重跑中",
      confirmRerun: "确认重跑",
      deleteHelp: "删除这个任务、运行日志，以及对应的整个会话目录：",
      deleteTask: "删除任务",
      deleteTitle: "确认删除这个任务？",
      deleteDescription: "这会永久删除任务记录、日志文件和整个会话目录。此操作无法撤销。",
      deleting: "删除中",
      confirmDelete: "确认删除",
      runningLocked: "运行中的任务不能重跑或删除，请等待任务完成或失败。",
      loadError: "加载任务失败",
      deleteError: "删除任务失败",
      rerunError: "重跑任务失败",
      resumeError: "继续任务失败",
    },
    settings: {
      button: "设置",
      title: "运行设置",
      description: "设置会由 FastAPI 后端保存在本机。",
      language: "界面语言",
      cookie: "YouTube Cookie",
      savedCookie: "******** 已保存 YouTube Cookie ********",
      cookiePlaceholder: "粘贴 Netscape 格式 Cookie 内容",
      proxyPort: "yt-dlp 代理端口",
      baseUrl: "OpenAI Base URL",
      apiKey: "OpenAI API Key",
      apiKeyPlaceholder: "留空则保留现有 key",
      hideApiKey: "隐藏 API key",
      showApiKey: "显示 API key",
      model: "模型",
      selectModel: "选择模型",
      loading: "加载中",
      getModels: "获取模型",
      translateConcurrency: "翻译并发数",
      concurrencyHelp: "翻译阶段并行发起的 OpenAI 请求数。如果你的服务商允许，可以适当调高。",
      save: "保存设置",
      keySaved: "OpenAI API key 已保存。",
      saved: "设置已保存。",
      saveError: "保存设置失败",
      noModels: "没有返回可用模型。",
      loadModelsError: "加载模型失败",
    },
    status: {
      queued: "排队中",
      running: "运行中",
      succeeded: "已完成",
      failed: "失败",
      pending: "等待中",
    },
    stages: {
      download: "下载视频",
      separate: "分离人声与背景音",
      asr: "语音识别",
      asr_fix: "切分句子",
      translate: "翻译字幕",
      split_audio: "切分音频",
      tts: "生成配音",
      merge_audio: "混合音频",
      merge_video: "合成视频",
      done: "已完成",
    },
  },
}

type LanguageContextValue = {
  language: UiLanguage
  setLanguage: (language: UiLanguage) => void
  t: Messages
  activeTasksText: (count: number) => string
  loadedModelsText: (count: number) => string
  statusLabel: (status?: string | null) => string
  stageLabel: (name?: string | null, fallback?: string | null) => string
}

const LanguageContext = createContext<LanguageContextValue | null>(null)

function isLanguage(value: string | null): value is UiLanguage {
  return value === "en" || value === "zh"
}

function setDocumentLanguage(language: UiLanguage) {
  document.documentElement.lang = language === "zh" ? "zh-CN" : "en"
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<UiLanguage>("zh")

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY)
    if (!isLanguage(saved)) return
    window.setTimeout(() => setLanguageState(saved), 0)
  }, [])

  useEffect(() => {
    setDocumentLanguage(language)
  }, [language])

  const value = useMemo<LanguageContextValue>(() => {
    const t = messages[language]
    return {
      language,
      setLanguage: (next) => {
        setLanguageState(next)
        window.localStorage.setItem(STORAGE_KEY, next)
        setDocumentLanguage(next)
      },
      t,
      activeTasksText: (count) =>
        language === "zh"
          ? `${count} 个任务正在排队或运行`
          : `${count} task${count > 1 ? "s" : ""} queued / running`,
      loadedModelsText: (count) =>
        language === "zh" ? `已加载 ${count} 个模型。` : `${count} models loaded.`,
      statusLabel: (status) => {
        if (!status) return t.common.loading
        return t.status[status as keyof typeof t.status] || status
      },
      stageLabel: (name, fallback) => {
        if (name && name in t.stages) return t.stages[name as keyof typeof t.stages]
        if (fallback && fallback in t.stages) return t.stages[fallback as keyof typeof t.stages]
        return fallback || name || t.common.waiting
      },
    }
  }, [language])

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}

export function useI18n() {
  const context = useContext(LanguageContext)
  if (!context) {
    throw new Error("useI18n must be used inside LanguageProvider")
  }
  return context
}
