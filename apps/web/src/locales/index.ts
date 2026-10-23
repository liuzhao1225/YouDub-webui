import en from './en.json'
import zh from './zh.json'
import ja from './ja.json'

export type MessageKey = keyof typeof en.messages
export type MessageParams = Record<string, string | number>
export interface LanguagePack {
  id: string
  label: string
  short: string
  fallback?: string
  messages: Record<MessageKey, string>
}

// One catalog for settings, business copy and Harness language registration.
export const languagePacks: readonly LanguagePack[] = [zh, en, ja]
export type UiLanguage = string
export const LANGUAGE_OPTIONS = languagePacks.map(({ id, label, short }) => ({ value: id, label, short }))
export function isLanguage(value: string | null): value is UiLanguage {
  return languagePacks.some(pack => pack.id === value)
}
export type Text = (key: MessageKey, params?: MessageParams) => string
export function translateMessage(language: string, key: MessageKey, params?: MessageParams): string {
  const dictionary = languagePacks.find(pack => pack.id === language)?.messages ?? en.messages
  const template = dictionary[key]
  return params ? template.replace(/\{(\w+)\}/g, (match, name) => name in params ? String(params[name]) : match) : template
}
export function sharedMessages(translate: Text) {
  return {
nav: {newTask: translate('nav.newTask'), primary: translate('nav.primary'), language: translate('nav.language'), switchToLight: translate('nav.switchToLight'), switchToDark: translate('nav.switchToDark'), collapseSidebar: translate('nav.collapseSidebar'), expandSidebar: translate('nav.expandSidebar')},
studio: {heroTitleLead: translate('studio.heroTitleLead'), heroTitleAccent: translate('studio.heroTitleAccent'), heroSubtitle: translate('studio.heroSubtitle')},
player: {label: translate('player.label'), play: translate('player.play'), pause: translate('player.pause'), mute: translate('player.mute'), unmute: translate('player.unmute'), volume: translate('player.volume'), seek: translate('player.seek'), speed: translate('player.speed'), fullscreen: translate('player.fullscreen'), exitFullscreen: translate('player.exitFullscreen'), pip: translate('player.pip')},
auth: {welcome: translate('auth.welcome'), showPassword: translate('auth.showPassword'), hidePassword: translate('auth.hidePassword'), subtitle: translate('auth.subtitle'), password: translate('auth.password'), signIn: translate('auth.signIn'), sessionLoading: translate('auth.sessionLoading'), logout: translate('auth.logout')}
  }
}
