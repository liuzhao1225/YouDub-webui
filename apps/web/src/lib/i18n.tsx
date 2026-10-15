"use client"

import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react"

export type UiLanguage = "en" | "zh" | "ja"

const STORAGE_KEY = "youdub-ui-language"

export const LANGUAGE_OPTIONS: { value: UiLanguage; label: string; short: string }[] = [
  { value: "zh", label: "中文", short: "中" },
  { value: "en", label: "English", short: "EN" },
  { value: "ja", label: "日本語", short: "日" },
]

// 外壳与播放器的共享文案；插件内的文案通过 useText 就地给出三种语言。
type Messages = {
  nav: {
    newTask: string
    primary: string
    language: string
    switchToLight: string
    switchToDark: string
    collapseSidebar: string
    expandSidebar: string
  }
  studio: {
    heroTitleLead: string
    heroTitleAccent: string
    heroSubtitle: string
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
    sessionLoading: string
    logout: string
  }
}

const messages: Record<UiLanguage, Messages> = {
  en: {
    nav: {
      newTask: "New task",
      primary: "Main navigation",
      language: "Language",
      switchToLight: "Switch to light",
      switchToDark: "Switch to dark",
      collapseSidebar: "Collapse sidebar",
      expandSidebar: "Expand sidebar",
    },
    studio: {
      heroTitleLead: "Make every video speak",
      heroTitleAccent: "another language",
      heroSubtitle: "Import a local video. YouDub separates the voice, transcribes, translates and dubs it, then renders subtitles or a dubbed cut.",
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
      sessionLoading: "Checking your session...",
      logout: "Sign out",
    },
  },
  zh: {
    nav: {
      newTask: "新建任务",
      primary: "主导航",
      language: "界面语言",
      switchToLight: "切换到浅色",
      switchToDark: "切换到深色",
      collapseSidebar: "收起侧边栏",
      expandSidebar: "展开侧边栏",
    },
    studio: {
      heroTitleLead: "让视频说",
      heroTitleAccent: "另一种语言",
      heroSubtitle: "导入本地视频，YouDub 自动完成人声分离、语音识别、翻译与配音，生成字幕或配音成片。",
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
      sessionLoading: "正在检查登录状态...",
      logout: "退出登录",
    },
  },
  ja: {
    nav: {
      newTask: "新規タスク",
      primary: "メインナビゲーション",
      language: "表示言語",
      switchToLight: "ライトに切り替え",
      switchToDark: "ダークに切り替え",
      collapseSidebar: "サイドバーを閉じる",
      expandSidebar: "サイドバーを開く",
    },
    studio: {
      heroTitleLead: "動画を、",
      heroTitleAccent: "別の言語で。",
      heroSubtitle: "ローカル動画を読み込むと、YouDub が音声分離・文字起こし・翻訳・吹き替えを行い、字幕付きまたは吹き替え済みの動画を書き出します。",
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
      sessionLoading: "ログイン状態を確認中...",
      logout: "ログアウト",
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

export function useText() {
  const { language } = useI18n()
  return useCallback((en: string, zh: string, ja: string) => (
    language === "zh" ? zh : language === "ja" ? ja : en
  ), [language])
}

export type Text = ReturnType<typeof useText>
