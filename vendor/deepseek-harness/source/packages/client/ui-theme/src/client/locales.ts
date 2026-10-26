/** `settings.theme` namespace dictionaries (Appearance and font-size shortcut copy). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'appearance.title': '外观',
  'appearance.light': '浅色',
  'appearance.dark': '深色',
  'appearance.system': '跟随系统',
  'fontSize.text.increase': '增大字号',
  'fontSize.text.decrease': '减小字号',
} satisfies Record<string, string>

/** The settings.theme namespace key union. */
export type ThemeKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'appearance.title': 'Appearance',
  'appearance.light': 'Light',
  'appearance.dark': 'Dark',
  'appearance.system': 'System',
  'fontSize.text.increase': 'Increase font size',
  'fontSize.text.decrease': 'Decrease font size',
} satisfies Record<ThemeKey, string>
