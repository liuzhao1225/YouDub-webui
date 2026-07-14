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
  auth: Record<string, string>
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
      localSubtitleLabel: "Translated SRT subtitles (optional)",
      localSubtitleHelp: "When provided, the SRT is used for TTS and burned subtitles, and Whisper/OpenAI translation are skipped.",
      currentLocalVideo: "Current video",
      subtitleForCurrentVideo: "Subtitle for current video",
      noSubtitleSelected: "Not selected",
      localDirectionLabel: "Translation direction",
      localEnZh: "English -> Chinese",
      localZhEn: "Chinese -> English",
      submitting: "Submitting",
      createTask: "Create task",
      executionModeLabel: "Execution mode",
      executionAuto: "Auto (run all stages)",
      executionManual: "Manual (step by step)",
      taskHistory: "Task history",
      empty: "No tasks yet. Submit a URL or upload a local video above to start.",
      taskSearchPlaceholder: "Search title, URL, or task ID",
      taskStatusFilter: "Status",
      taskModeFilter: "Mode",
      taskSort: "Sort",
      taskPageSize: "Page size",
      allStatuses: "All statuses",
      allModes: "All modes",
      modeAuto: "Auto",
      modeManual: "Manual",
      sortCreatedDesc: "Created: newest",
      sortCreatedAsc: "Created: oldest",
      sortStartedDesc: "Started: newest",
      sortStartedAsc: "Started: oldest",
      sortCompletedDesc: "Completed: newest",
      sortCompletedAsc: "Completed: oldest",
      sortStatusAsc: "Status: ascending",
      sortStatusDesc: "Status: descending",
      sortTitleAsc: "Title: A-Z",
      sortTitleDesc: "Title: Z-A",
      noMatchingTasks: "No matching tasks.",
      previousPage: "Previous",
      nextPage: "Next",
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
      continueHelp: "Run the next stage. Completed stages stay cached.",
      continueTask: "Run next stage",
      continueAutoHelp: "Run all remaining stages automatically.",
      continueAutoTask: "Run remaining automatically",
      continuing: "Continuing",
      executionMode: "Execution mode",
      executionAuto: "Auto",
      executionManual: "Manual",
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
      continueError: "Failed to continue task",
      redoStage: "Redo",
      redoingStage: "Redoing",
      redoStageError: "Failed to redo stage",
      redoStageHelp: "Re-run this stage and clear downstream artifacts. Earlier stages stay cached.",
      redoStageTitle: "Redo this stage?",
      redoStageDescription: "This clears this stage and all downstream artifacts, then re-queues from",
      confirmRedoStage: "Confirm redo",
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
      saving: "Saving",
      keySaved: "OpenAI key is saved.",
      saved: "Settings saved.",
      saveError: "Failed to save settings",
      saveResultsTitle: "Save results",
      openaiSaveSection: "OpenAI settings",
      ytdlpSaveSection: "yt-dlp settings",
      saveSucceeded: "Saved",
      saveFailed: "Failed",
      saveUnchanged: "Unchanged",
      reloadError: "Some saved values could not be reloaded. Reopen settings to verify the current server state.",
      noModels: "No models returned.",
      loadModelsError: "Failed to load models",
    },
    auth: {
      title: "Sign in to YouDub",
      password: "Password",
      signIn: "Sign in",
      signingIn: "Signing in",
      invalidCredentials: "Incorrect password.",
      loginError: "Unable to sign in. Please try again.",
      sessionLoading: "Checking your session...",
      sessionError: "Unable to check your session.",
      retry: "Try again",
      logout: "Sign out",
      loggingOut: "Signing out",
    },
    status: {
      queued: "queued",
      running: "running",
      paused: "paused",
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
      localSubtitleLabel: "已翻译 SRT 字幕（可选）",
      localSubtitleHelp: "上传后会直接用于配音和压制字幕，并跳过 Whisper 识别与 OpenAI 翻译。",
      currentLocalVideo: "当前视频",
      subtitleForCurrentVideo: "当前视频关联字幕",
      noSubtitleSelected: "未选择",
      localDirectionLabel: "翻译方向",
      localEnZh: "英文 -> 中文",
      localZhEn: "中文 -> 英文",
      submitting: "提交中",
      createTask: "创建任务",
      executionModeLabel: "执行模式",
      executionAuto: "自动（连续执行全部阶段）",
      executionManual: "手动（逐步执行）",
      taskHistory: "任务历史",
      empty: "暂无任务。输入链接或上传本地视频后即可开始。",
      taskSearchPlaceholder: "搜索标题、链接或任务 ID",
      taskStatusFilter: "状态",
      taskModeFilter: "模式",
      taskSort: "排序",
      taskPageSize: "每页条数",
      allStatuses: "全部状态",
      allModes: "全部模式",
      modeAuto: "自动",
      modeManual: "手动",
      sortCreatedDesc: "创建时间新到旧",
      sortCreatedAsc: "创建时间旧到新",
      sortStartedDesc: "开始时间新到旧",
      sortStartedAsc: "开始时间旧到新",
      sortCompletedDesc: "完成时间新到旧",
      sortCompletedAsc: "完成时间旧到新",
      sortStatusAsc: "状态正序",
      sortStatusDesc: "状态倒序",
      sortTitleAsc: "标题 A-Z",
      sortTitleDesc: "标题 Z-A",
      noMatchingTasks: "没有匹配的任务。",
      previousPage: "上一页",
      nextPage: "下一页",
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
      continueHelp: "执行下一个阶段。已完成的阶段会保留缓存。",
      continueTask: "执行下一阶段",
      continueAutoHelp: "自动执行剩余所有阶段。",
      continueAutoTask: "自动执行剩余阶段",
      continuing: "继续中",
      executionMode: "执行模式",
      executionAuto: "自动",
      executionManual: "手动",
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
      continueError: "执行下一阶段失败",
      redoStage: "重做",
      redoingStage: "重做中",
      redoStageError: "重做阶段失败",
      redoStageHelp: "重新执行该阶段并清除下游产物，更早的阶段会保留缓存。",
      redoStageTitle: "确认重做这个阶段？",
      redoStageDescription: "这会清除该阶段及所有下游产物，并从这里重新排队执行：",
      confirmRedoStage: "确认重做",
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
      saving: "保存中",
      keySaved: "OpenAI API key 已保存。",
      saved: "设置已保存。",
      saveError: "保存设置失败",
      saveResultsTitle: "各项保存结果",
      openaiSaveSection: "OpenAI 设置",
      ytdlpSaveSection: "yt-dlp 设置",
      saveSucceeded: "保存成功",
      saveFailed: "保存失败",
      saveUnchanged: "未修改",
      reloadError: "部分保存结果无法重新读取，请重新打开设置确认服务端当前状态。",
      noModels: "没有返回可用模型。",
      loadModelsError: "加载模型失败",
    },
    auth: {
      title: "登录 YouDub",
      password: "访问密码",
      signIn: "登录",
      signingIn: "登录中",
      invalidCredentials: "密码错误。",
      loginError: "登录失败，请重试。",
      sessionLoading: "正在检查登录状态...",
      sessionError: "无法检查登录状态。",
      retry: "重试",
      logout: "退出登录",
      loggingOut: "退出中",
    },
    status: {
      queued: "排队中",
      running: "运行中",
      paused: "已暂停",
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
