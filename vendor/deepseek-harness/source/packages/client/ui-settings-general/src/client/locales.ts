/** Shell chrome and General-nav dictionaries; feature rows own their copy. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'trigger': '设置',
  'shortcut.open': '打开设置',
  'desktop.update.available': '新版本',
  'desktop.update.checking': '正在检查更新…',
  'desktop.update.retry': '重试更新',
  'desktop.update.versionDetail': '{label}：{version}',
  'desktop.update.checkFailed': '检查更新失败，请稍后重试。',
  'title': '设置',
  'close': '关闭',
  'openDocument': '打开配置文件',
  'openDocument.error': '无法打开配置文件',
  'general.nav': '通用设置',
  'general.currentVersion': '当前版本：{version}',
  'connection.error': '连接异常，刷新重试',
  'connection.connecting': '重新连接中',
  'connection.connected': '连接成功',
  'connection.reconnect': '连接异常，点击立即重连',
  'connection.restart': '连接中断，正在重试，点击立即重连',
  'hostRelease.title': '服务版本变化',
  'hostRelease.description': '服务版本已变化，本页面已暂停热更新，刷新后加载新版本。',
  'hostRelease.service': '服务',
  'hostRelease.page': '页面',
  'hostRelease.unknown': '未解析',
  'hostRelease.reload': '刷新以加载新版本',
  'hostRelease.later': '暂不刷新',
} satisfies Record<string, string>

/** The settings namespace key union. */
export type SettingsKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'trigger': 'Settings',
  'shortcut.open': 'Open settings',
  'desktop.update.available': 'Update',
  'desktop.update.checking': 'Checking for updates…',
  'desktop.update.retry': 'Retry update',
  'desktop.update.versionDetail': '{label}: {version}',
  'desktop.update.checkFailed': 'Could not check for updates. Please try again later.',
  'title': 'Settings',
  'close': 'Close',
  'openDocument': 'Open configuration file',
  'openDocument.error': 'Could not open configuration file',
  'general.nav': 'General',
  'general.currentVersion': 'Current version: {version}',
  'connection.error': 'Disconnected',
  'connection.connecting': 'Reconnecting',
  'connection.connected': 'Connected',
  'connection.reconnect': 'Disconnected, reconnect now',
  'connection.restart': 'Reconnecting, reconnect now',
  'hostRelease.title': 'Service version changed',
  'hostRelease.description': 'The service version changed. This page paused live updates; reload to load the new version.',
  'hostRelease.service': 'Service',
  'hostRelease.page': 'Page',
  'hostRelease.unknown': 'Unknown',
  'hostRelease.reload': 'Reload to load the new version',
  'hostRelease.later': 'Not now',
} satisfies Record<SettingsKey, string>
