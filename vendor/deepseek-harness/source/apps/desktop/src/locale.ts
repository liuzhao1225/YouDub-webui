/** Typed English and Chinese copy owned by the Electron shell. */

export const en = {
  application: 'Application',
  fileMenu: 'File',
  closePage: 'Close Page or Window',
  aboutMenu: 'About YouDub',
  aboutProduct: 'YouDub',
  aboutVersion: 'Version V{version}',
  hideApplication: 'Hide YouDub',
  hideOtherApplications: 'Hide Others',
  showAllApplications: 'Show All',
  quitApplication: 'Quit YouDub',
  openApplication: 'Open YouDub',
  quit: 'Quit',
  cancel: 'Cancel',
  quitTitle: 'Quit YouDub?',
  quitUnsavedChanges: 'Unsaved changes will be lost.',
  quitActiveTasks: 'Running tasks will be interrupted.',
  quitScheduledTasks: 'Scheduled tasks will not run while the app is closed.',
  quitActiveAndScheduledTasks: 'Running tasks will be interrupted, and scheduled tasks will not run while the app is closed.',
  backgroundNoticeBody: 'Running tasks will continue. You can reopen the window from the system tray.',
  backgroundNoticeConfirm: 'Confirm',
  edit: 'Edit',
  menuBar: 'Application menu',
  delete: 'Delete',
  undo: 'Undo',
  redo: 'Redo',
  cut: 'Cut',
  copy: 'Copy',
  paste: 'Paste',
  selectAll: 'Select All',
  startupFailed: 'YouDub could not start',
  fatalSummary: 'The application could not start or stopped unexpectedly.',
  startupAddressInUse: 'The local service port is already in use. Close the process using that port, then restart YouDub.',
  diagnosticTruncated: '… Error details shortened.',
  reportWrittenTo: 'Diagnostic report: {path}',
  startupReinstallAdvice: 'If application files are missing or damaged, close the application and reinstall it. Your tasks are stored separately.',
  exitApplication: 'Exit',
  restartApplication: 'Restart',
  recoveryOperationFailed: 'The recovery operation failed',
  disableThirdPartyPlugins: 'Disable third-party plugins, back up profile patch, and restart',
  checkUpdatesMenu: 'Check for Updates…',
  reloadPageMenu: 'Reload Page',
  restartAppHostMenu: 'Restart App and Host',
  updateCheckFailedTitle: 'Update Check Failed',
  updateDownloadFailed: 'Could not download the update. Please try again.',
  updateCheckTitle: 'Check for Updates',
  updateCurrentDetail: 'Current version: {version}',
  updateCurrent: 'You’re up to date!',
  updateDownload: 'Download update',
  updateClose: 'Close',
  updateLater: 'Update later',
  updateTitle: 'YouDub Update',
  updateAvailable: 'New version available: {version}',
  updateDetail: 'Once the download is complete, you can install the update and restart the app.',
} as const

/** Every Desktop locale supplies the complete English key set. */
export type DesktopMessages = { readonly [Key in keyof typeof en]: string }

export const zh = {
  application: '应用',
  fileMenu: '文件',
  closePage: '关闭页面或窗口',
  aboutMenu: '关于 YouDub',
  aboutProduct: 'YouDub',
  aboutVersion: '版本 V{version}',
  hideApplication: '隐藏 YouDub',
  hideOtherApplications: '隐藏其他',
  showAllApplications: '显示全部',
  quitApplication: '退出 YouDub',
  openApplication: '打开 YouDub',
  quit: '退出',
  cancel: '取消',
  quitTitle: '退出 YouDub？',
  quitUnsavedChanges: '未保存的修改将丢失。',
  quitActiveTasks: '当前正在运行的任务将会中断',
  quitScheduledTasks: '应用关闭期间，定时任务不会运行',
  quitActiveAndScheduledTasks: '当前正在运行的任务将会中断，且应用关闭期间，定时任务不会运行',
  backgroundNoticeBody: '正在运行的任务不会中断，可在系统托盘中重新打开窗口',
  backgroundNoticeConfirm: '确认',
  edit: '编辑',
  menuBar: '应用菜单',
  delete: '删除',
  undo: '撤销',
  redo: '重做',
  cut: '剪切',
  copy: '复制',
  paste: '粘贴',
  selectAll: '全选',
  startupFailed: 'YouDub 无法启动',
  fatalSummary: '应用无法启动或已意外停止。',
  startupAddressInUse: '本地服务端口已被占用。请关闭占用该端口的进程，再重启 YouDub。',
  diagnosticTruncated: '… 错误详情已截短。',
  reportWrittenTo: '诊断报告：{path}',
  startupReinstallAdvice: '如果应用文件缺失或损坏，请关闭应用并重新安装。任务数据存储在独立位置。',
  exitApplication: '退出',
  restartApplication: '重启',
  recoveryOperationFailed: '恢复操作失败',
  disableThirdPartyPlugins: '禁用第三方插件、备份 profile patch 并重启',
  checkUpdatesMenu: '检查更新…',
  reloadPageMenu: '刷新页面',
  restartAppHostMenu: '重启应用与 Host',
  updateCheckFailedTitle: '更新检查失败',
  updateDownloadFailed: '下载更新失败，请重试。',
  updateCheckTitle: '检查更新',
  updateCurrentDetail: '当前版本：{version}',
  updateCurrent: '已是最新版本',
  updateDownload: '下载更新',
  updateClose: '关闭',
  updateLater: '稍后更新',
  updateTitle: 'YouDub 更新',
  updateAvailable: '发现新版本 {version}',
  updateDetail: '下载完成后，可安装并重启应用。',
} as const satisfies DesktopMessages

/** Japanese copy for the desktop surfaces used by YouDub. */
export const ja = {
  ...en,
  application: 'アプリケーション', fileMenu: 'ファイル', closePage: 'ページまたはウィンドウを閉じる',
  aboutMenu: 'YouDub について', aboutProduct: 'YouDub', aboutVersion: 'バージョン {version}',
  hideApplication: 'YouDub を隠す', hideOtherApplications: 'ほかを隠す', showAllApplications: 'すべて表示',
  quitApplication: 'YouDub を終了', openApplication: 'YouDub を開く', quit: '終了', cancel: 'キャンセル',
  quitTitle: 'YouDub を終了しますか？', quitUnsavedChanges: '未保存の変更は失われます。',
  quitActiveTasks: '実行中のタスクは中断されます。', quitScheduledTasks: '終了中は予約タスクを実行できません。',
  quitActiveAndScheduledTasks: '実行中のタスクは中断され、終了中は予約タスクを実行できません。',
  edit: '編集', menuBar: 'アプリケーションメニュー', delete: '削除', undo: '取り消す', redo: 'やり直す',
  cut: 'カット', copy: 'コピー', paste: 'ペースト', selectAll: 'すべて選択',
  startupFailed: 'YouDub を起動できません', fatalSummary: 'アプリを起動できないか、予期せず停止しました。',
  startupAddressInUse: 'ローカルサービスのポートが使用中です。そのポートを使用しているプロセスを終了してから、YouDub を再起動してください。',
  diagnosticTruncated: '… エラー詳細を省略しました。', reportWrittenTo: '診断レポート：{path}',
  startupReinstallAdvice: 'アプリのファイルが破損している場合は再インストールしてください。タスクは別の場所に保存されています。',
  exitApplication: '終了', restartApplication: '再起動', recoveryOperationFailed: '復旧処理に失敗しました',
  disableThirdPartyPlugins: '外部プラグインを無効にし、設定をバックアップして再起動',
  updateTitle: 'YouDub の更新',
} as const satisfies DesktopMessages

/** Locale payload exposed to the Desktop-owned renderer. */
export interface DesktopLocale {
  readonly id: 'en' | 'zh-CN' | 'ja'
  readonly messages: DesktopMessages
}

/** Resolve Electron's locale to one shipped Desktop dictionary. */
export function resolveDesktopLocale(locale: string): DesktopLocale {
  if (locale.toLowerCase().startsWith('ja')) return { id: 'ja', messages: ja }
  return locale.toLowerCase().startsWith('zh')
    ? { id: 'zh-CN', messages: zh }
    : { id: 'en', messages: en }
}

/**
 * Choose a built-in dictionary from the shared preference, then ordered OS languages.
 * @param preference - explicit locale.preference, or null when no language was selected.
 * @param languages - operating-system languages in preference order.
 * @returns the supported dictionary, falling back to English.
 */
export function resolveDesktopStartupLocale(preference: string | null, languages: readonly string[]): DesktopLocale {
  const selected = preference?.toLowerCase()
  if (selected === 'zh' || selected === 'en' || selected === 'ja') return resolveDesktopLocale(selected)
  for (const language of languages) {
    const primary = language.toLowerCase().split('-')[0]
    if (primary === 'zh' || primary === 'en' || primary === 'ja') return resolveDesktopLocale(primary)
  }
  return resolveDesktopLocale('en')
}

/** Replace named placeholders in one locale-owned message. */
export function formatDesktopMessage(
  message: string,
  values: Readonly<Record<string, string>>,
): string {
  return message.replaceAll(/\{([^{}]+)\}/gu, (placeholder, key: string) => values[key] ?? placeholder)
}
