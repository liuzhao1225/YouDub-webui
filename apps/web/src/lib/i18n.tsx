"use client"

import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react"

export type UiLanguage = "en" | "zh" | "ja"

const STORAGE_KEY = "youdub-ui-language"

export const LANGUAGE_OPTIONS: { value: UiLanguage; label: string; short: string }[] = [
  { value: "zh", label: "中文", short: "中" },
  { value: "en", label: "English", short: "EN" },
  { value: "ja", label: "日本語", short: "日" },
]

// 应用外壳（导航、登录、播放器等）的文案；v1 页面内的文案按 v1 约定用 useV1Text 就地给出三种语言。
type Messages = {
  common: {
    back: string
    cancel: string
    close: string
    loading: string
    copy: string
    copied: string
  }
  nav: {
    studio: string
    library: string
    settings: string
    newTask: string
    primary: string
    processing: string
    queueIdle: string
    queueIdleHint: string
    queuedOnly: string
    language: string
    theme: string
    themeDark: string
    themeLight: string
    switchToLight: string
    switchToDark: string
    collapseSidebar: string
    expandSidebar: string
  }
  studio: {
    heroBadge: string
    heroTitleLead: string
    heroTitleAccent: string
    heroSubtitle: string
    featureSeparate: string
    featureAsr: string
    featureTranslate: string
    featureDub: string
  }
  player: {
    label: string
    play: string
    pause: string
    mute: string
    unmute: string
    volume: string
    seek: string
    speed: string
    fullscreen: string
    exitFullscreen: string
    pip: string
  }
  auth: {
    welcome: string
    showPassword: string
    hidePassword: string
    subtitle: string
    password: string
    signIn: string
    signingIn: string
    passwordRequired: string
    invalidCredentials: string
    loginError: string
    sessionLoading: string
    sessionError: string
    retry: string
    logout: string
    loggingOut: string
  }
}

const messages: Record<UiLanguage, Messages> = {
  en: {
    common: {
      back: "Back",
      cancel: "Cancel",
      close: "Close",
      loading: "loading",
      copy: "Copy",
      copied: "Copied",
    },
    nav: {
      studio: "Studio",
      library: "Library",
      settings: "Settings",
      newTask: "New task",
      primary: "Main navigation",
      processing: "Processing",
      queueIdle: "Queue idle",
      queueIdleHint: "New tasks will show their progress here.",
      queuedOnly: "Waiting to start",
      language: "Language",
      theme: "Appearance",
      themeDark: "Dark",
      themeLight: "Light",
      switchToLight: "Switch to light",
      switchToDark: "Switch to dark",
      collapseSidebar: "Collapse sidebar",
      expandSidebar: "Expand sidebar",
    },
    studio: {
      heroBadge: "AI translation · Dubbing · Subtitles",
      heroTitleLead: "Make every video speak",
      heroTitleAccent: "another language",
      heroSubtitle: "Import a local video. YouDub separates the voice, transcribes, translates and dubs it, then renders subtitles or a dubbed cut.",
      featureSeparate: "Vocal separation",
      featureAsr: "Transcription",
      featureTranslate: "Translation",
      featureDub: "AI dubbing",
    },
    player: {
      label: "Video player",
      play: "Play",
      pause: "Pause",
      mute: "Mute",
      unmute: "Unmute",
      volume: "Volume",
      seek: "Seek",
      speed: "Playback speed",
      fullscreen: "Fullscreen",
      exitFullscreen: "Exit fullscreen",
      pip: "Picture-in-picture",
    },
    auth: {
      welcome: "Welcome back",
      showPassword: "Show password",
      hidePassword: "Hide password",
      subtitle: "Enter the access password configured for this deployment.",
      password: "Password",
      signIn: "Sign in",
      signingIn: "Signing in",
      passwordRequired: "Enter the access password.",
      invalidCredentials: "Incorrect password.",
      loginError: "Unable to sign in. Please try again.",
      sessionLoading: "Checking your session...",
      sessionError: "Unable to check your session.",
      retry: "Try again",
      logout: "Sign out",
      loggingOut: "Signing out",
    },
  },
  zh: {
    common: {
      back: "返回",
      cancel: "取消",
      close: "关闭",
      loading: "加载中",
      copy: "复制",
      copied: "已复制",
    },
    nav: {
      studio: "工作台",
      library: "任务库",
      settings: "设置",
      newTask: "新建任务",
      primary: "主导航",
      processing: "处理中",
      queueIdle: "队列空闲",
      queueIdleHint: "新任务开始后会在这里显示进度。",
      queuedOnly: "等待开始",
      language: "界面语言",
      theme: "外观",
      themeDark: "深色",
      themeLight: "浅色",
      switchToLight: "切换到浅色",
      switchToDark: "切换到深色",
      collapseSidebar: "收起侧边栏",
      expandSidebar: "展开侧边栏",
    },
    studio: {
      heroBadge: "AI 视频翻译 · 配音 · 字幕",
      heroTitleLead: "让视频说",
      heroTitleAccent: "另一种语言",
      heroSubtitle: "导入本地视频，YouDub 自动完成人声分离、语音识别、翻译与配音，生成字幕或配音成片。",
      featureSeparate: "人声分离",
      featureAsr: "语音识别",
      featureTranslate: "智能翻译",
      featureDub: "AI 配音",
    },
    player: {
      label: "视频播放器",
      play: "播放",
      pause: "暂停",
      mute: "静音",
      unmute: "取消静音",
      volume: "音量",
      seek: "播放进度",
      speed: "倍速",
      fullscreen: "全屏",
      exitFullscreen: "退出全屏",
      pip: "画中画",
    },
    auth: {
      welcome: "欢迎回来",
      showPassword: "显示密码",
      hidePassword: "隐藏密码",
      subtitle: "输入部署时设置的访问密码。",
      password: "访问密码",
      signIn: "登录",
      signingIn: "登录中",
      passwordRequired: "请输入访问密码。",
      invalidCredentials: "密码错误。",
      loginError: "登录失败，请重试。",
      sessionLoading: "正在检查登录状态...",
      sessionError: "无法检查登录状态。",
      retry: "重试",
      logout: "退出登录",
      loggingOut: "退出中",
    },
  },
  ja: {
    common: {
      back: "戻る",
      cancel: "キャンセル",
      close: "閉じる",
      loading: "読み込み中",
      copy: "コピー",
      copied: "コピーしました",
    },
    nav: {
      studio: "スタジオ",
      library: "ライブラリ",
      settings: "設定",
      newTask: "新規タスク",
      primary: "メインナビゲーション",
      processing: "処理中",
      queueIdle: "待機中のタスクなし",
      queueIdleHint: "新しいタスクを開始すると、ここに進捗が表示されます。",
      queuedOnly: "開始待ち",
      language: "表示言語",
      theme: "外観",
      themeDark: "ダーク",
      themeLight: "ライト",
      switchToLight: "ライトに切り替え",
      switchToDark: "ダークに切り替え",
      collapseSidebar: "サイドバーを閉じる",
      expandSidebar: "サイドバーを開く",
    },
    studio: {
      heroBadge: "AI 動画翻訳 · 吹き替え · 字幕",
      heroTitleLead: "動画を、",
      heroTitleAccent: "別の言語で。",
      heroSubtitle: "ローカル動画を読み込むと、YouDub が音声分離・文字起こし・翻訳・吹き替えを行い、字幕付きまたは吹き替え済みの動画を書き出します。",
      featureSeparate: "音声分離",
      featureAsr: "文字起こし",
      featureTranslate: "翻訳",
      featureDub: "AI 吹き替え",
    },
    player: {
      label: "動画プレーヤー",
      play: "再生",
      pause: "一時停止",
      mute: "ミュート",
      unmute: "ミュート解除",
      volume: "音量",
      seek: "再生位置",
      speed: "再生速度",
      fullscreen: "全画面表示",
      exitFullscreen: "全画面表示を終了",
      pip: "ピクチャー・イン・ピクチャー",
    },
    auth: {
      welcome: "おかえりなさい",
      showPassword: "パスワードを表示",
      hidePassword: "パスワードを隠す",
      subtitle: "デプロイ時に設定したアクセスパスワードを入力してください。",
      password: "パスワード",
      signIn: "ログイン",
      signingIn: "ログイン中",
      passwordRequired: "パスワードを入力してください。",
      invalidCredentials: "パスワードが正しくありません。",
      loginError: "ログインできませんでした。もう一度お試しください。",
      sessionLoading: "ログイン状態を確認中...",
      sessionError: "ログイン状態を確認できません。",
      retry: "再試行",
      logout: "ログアウト",
      loggingOut: "ログアウト中",
    },
  },
}

type LanguageContextValue = {
  language: UiLanguage
  setLanguage: (language: UiLanguage) => void
  t: Messages
}

const LanguageContext = createContext<LanguageContextValue | null>(null)

function isLanguage(value: string | null): value is UiLanguage {
  return value === "en" || value === "zh" || value === "ja"
}

function setDocumentLanguage(language: UiLanguage) {
  document.documentElement.lang = language === "zh" ? "zh-CN" : language
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<UiLanguage>("zh")

  const setLanguage = useCallback((next: UiLanguage) => {
    setLanguageState(next)
    window.localStorage.setItem(STORAGE_KEY, next)
    setDocumentLanguage(next)
  }, [])

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY)
    if (!isLanguage(saved)) return
    window.setTimeout(() => setLanguageState(saved), 0)
  }, [])

  useEffect(() => {
    setDocumentLanguage(language)
  }, [language])

  const value = useMemo<LanguageContextValue>(() => ({
    language,
    setLanguage,
    t: messages[language],
  }), [language, setLanguage])

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}

export function useI18n() {
  const context = useContext(LanguageContext)
  if (!context) {
    throw new Error("useI18n must be used inside LanguageProvider")
  }
  return context
}
