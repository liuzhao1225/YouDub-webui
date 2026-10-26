/**
 * Browser theme registry over the `--dsw-*` token stylesheets. The service
 * owns the live theme preference (light/dark/system), resolves `system` through
 * `prefers-color-scheme`, and publishes immutable snapshots; it never touches
 * the DOM — ui-layout's presenter consumes the resolved snapshot. The Host
 * settings scope loads and stores the preference in the user-settings
 * document. The plugin also registers the Appearance row
 * into the settings General section — the theme feature owns its own settings
 * surface. Desktop shortcuts adjust text and code font sizes together.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { BoundActions } from '@deepseek-ai/dsh-client-ui-slots'
import type { ShortcutCommandId } from '@deepseek-ai/dsh-client-shortcuts/client'
import type { NormalizedBinding } from '@deepseek-ai/dsh-client-shortcuts/protocol'
// Type-only: the ctx.configForms Context merge. Cross-plugin collaboration
// goes through the service, never a value import (client bundle purity gate).
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the SlotRegistry service merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { AppearanceRowInjected } from './AppearanceRow.tsx'
import { AppearanceRow } from './AppearanceRow.tsx'
import { createAppearanceRowStore } from './settings-store.ts'
import { installThemeStyles } from './styles.ts'
import { en, zh, type ThemeKey } from './locales.ts'
import {
  DEFAULT_FONT_SIZES, DEFAULT_PREFERENCE, FONT_ROLES, FONT_SIZE_SPECS,
  fontFamilyVariable, isFontSize, isThemePreference, normalizeFontFamily, sectionFontSizes,
  THEME_PREFERENCE_FIELD, THEME_SETTINGS_NAMESPACE,
  type FontFamilies, type FontRole, type FontSizes, type ThemePreference, type ThemeSettings,
} from '../theme-settings.ts'

export type { AppearanceRowComponentProps, AppearanceRowInjected } from './AppearanceRow.tsx'
export type { AppearanceRowState } from './settings-store.ts'
export type { ThemeKey } from './locales.ts'
export type { FontFamilies, FontRole, FontSizes, ThemePreference, ThemeSettings } from '../theme-settings.ts'

/** Namespace owning this feature's settings-row copy. */
export const SETTINGS_NS = 'settings.theme'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The Appearance settings row's copy. */
    'settings.theme': ThemeKey
  }
}

/** Immutable theme state published on every change. */
export interface ThemeSnapshot {
  /** The persisted preference (may be `system`). */
  preference: ThemePreference
  /** Integer px font sizes by role, each within its `FONT_SIZE_SPECS` range (`text` is the content size). */
  fontSizes: FontSizes
  /** Normalized user font lists by role; `''` selects the role's built-in stack. */
  fontFamilies: FontFamilies
  /** Resolved palette after applying the system color-scheme preference. */
  active: { readonly colorScheme: 'light' | 'dark' }
  /** Monotonic change counter (registry or active changes). */
  revision: number
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    theme: ThemeRuntime
  }
  interface Events {
    /**
     * Theme state changed (preference switched, registry updated, or the OS
     * color scheme changed while the preference is `system`).
     * @param snapshot - Current immutable theme snapshot.
     * @mode emit
     */
    'theme/change'(snapshot: ThemeSnapshot): void
  }
}

/** Owns durable appearance preferences and the system color-scheme listener. */
export class ThemeRuntime {
  private readonly ctx: ClientContext
  private readonly host: ConfigForm<ThemeSettings>
  private preference: ThemePreference
  private fontSizes: FontSizes = bootstrapFontSizes()
  private fontFamilies: FontFamilies = bootstrapFontFamilies()
  private revision = 0
  /** Own settings writes not yet settled; adoption waits for zero so a Host echo of an earlier write cannot revert a later local change. */
  private pendingWrites = 0
  private snapshot: ThemeSnapshot
  private readonly media: MediaQueryList | undefined

  /**
   * @param ctx - owning context (change events are emitted on it; the
   * media-query and scope listeners are released through ctx.effect on dispose).
   * @param host - durable preference scope owned by the same plugin.
   */
  constructor(ctx: ClientContext, host: ConfigForm<ThemeSettings>) {
    this.ctx = ctx
    this.host = host
    this.preference = DEFAULT_PREFERENCE
    // Non-browser runs (node e2e booting the client tree) have no matchMedia.
    this.media = typeof matchMedia === 'undefined' ? undefined : matchMedia('(prefers-color-scheme: dark)')
    this.snapshot = this.buildSnapshot()
    if (this.media !== undefined) {
      const media = this.media
      const onChange = (): void => {
        if (this.preference !== 'system') return
        this.publish()
      }
      ctx.effect(() => {
        media.addEventListener('change', onChange)
        return () => { media.removeEventListener('change', onChange) }
      }, 'ui-theme: prefers-color-scheme listener')
    }
    ctx.effect(() => host.subscribe(() => { this.adopt() }), 'ui-theme: settings scope adoption')
    this.adopt()
    installFontSizeShortcuts(ctx, (delta) => { this.adjustFontSizes(delta) })
  }

  /**
   * Read the current immutable theme snapshot.
   * @returns the current snapshot (stable reference until the next change).
   */
  getTheme(): ThemeSnapshot {
    return this.snapshot
  }

  /**
   * Switch the theme preference — the only user preference write entry.
   * Built-in preferences are written through the settings scope and every
   * accepted value emits `theme/change`.
   * @param id - light, dark, or system; unknown values throw.
   */
  setTheme(id: string): void {
    if (!isThemePreference(id)) throw new Error(`unknown theme preference "${id}"`)
    if (this.preference === id) return
    this.preference = id
    this.write(() => this.host.set(THEME_PREFERENCE_FIELD, id))
    this.publish()
  }

  /**
   * Step all font sizes within their own ranges and save changed fields in one mutation.
   * Emits one `theme/change`; no write or event occurs when every role is at its limit.
   * @param delta - one pixel to add or remove from each role's current size.
   */
  private adjustFontSizes(delta: 1 | -1): void {
    const fontSizes = { ...this.fontSizes }
    const fields: Record<string, number> = {}
    for (const role of FONT_ROLES) {
      const { field, min, max } = FONT_SIZE_SPECS[role]
      const px = Math.max(min, Math.min(max, fontSizes[role] + delta))
      if (px === fontSizes[role]) continue
      fontSizes[role] = px
      fields[field] = px
    }
    const ops = Object.entries(fields).map(([field, value]) => ({ op: 'set' as const, path: [field], value }))
    if (ops.length === 0) return
    this.fontSizes = Object.freeze(fontSizes)
    this.write(() => this.host.mutate(ops))
    this.publish()
  }

  /** Queue one settings write, then adopt the durable section once no own write remains. */
  private write(operation: () => Promise<boolean>): void {
    this.pendingWrites += 1
    void operation().finally(() => {
      this.pendingWrites -= 1
      this.adopt()
    })
  }

  /** Adopt the scope's accepted durable preference without writing it back. */
  private adopt(): void {
    if (this.pendingWrites > 0) return
    const section = this.host.getSnapshot().value
    if (section === undefined) return
    const fontFamilies = durableFontFamilies(section)
    const fontSizes = sectionFontSizes(section)
    if (this.preference === section.preference
      && FONT_ROLES.every(role => this.fontSizes[role] === fontSizes[role] && this.fontFamilies[role] === fontFamilies[role])) return
    this.preference = section.preference
    this.fontSizes = fontSizes
    this.fontFamilies = fontFamilies
    this.publish()
  }

  private buildSnapshot(): ThemeSnapshot {
    const colorScheme = this.preference === 'system'
      ? (this.media?.matches === true ? 'dark' : 'light')
      : this.preference
    return Object.freeze({
      preference: this.preference,
      fontSizes: this.fontSizes,
      fontFamilies: this.fontFamilies,
      active: Object.freeze({ colorScheme }),
      revision: this.revision,
    })
  }

  private publish(): void {
    this.revision += 1
    this.snapshot = this.buildSnapshot()
    this.ctx.emit('theme/change', this.snapshot)
  }
}

/**
 * Read the font sizes the Host boot script wrote on `body` before any plugin
 * ran, so the initial snapshot matches first paint and ui-layout's presenter
 * does not flash the schema defaults while the settings read is in flight.
 * Non-browser runs, mounts without the boot script, and out-of-range values
 * fall back to each role's default; the durable settings adoption still lands afterwards.
 */
function bootstrapFontSizes(): FontSizes {
  /* v8 ignore next -- needs a documentless run (node e2e booting the client tree), not constructible under jsdom */
  if (typeof document === 'undefined') return DEFAULT_FONT_SIZES
  const read = (role: FontRole): number => {
    const parsed = Number.parseInt(document.body.style.getPropertyValue(FONT_SIZE_SPECS[role].variable), 10)
    return isFontSize(role, parsed) ? parsed : FONT_SIZE_SPECS[role].default
  }
  return Object.freeze({ text: read('text'), code: read('code') })
}

/** Font lists the Host boot script wrote on `body`, read for the same first-paint reason as {@link bootstrapFontSizes}. */
function bootstrapFontFamilies(): FontFamilies {
  /* v8 ignore next -- needs a documentless run (node e2e booting the client tree), not constructible under jsdom */
  if (typeof document === 'undefined') return Object.freeze({ text: '', code: '' })
  const style = document.body.style
  return Object.freeze({
    text: normalizeFontFamily(style.getPropertyValue(fontFamilyVariable('text'))),
    code: normalizeFontFamily(style.getPropertyValue(fontFamilyVariable('code'))),
  })
}

/** Normalized font lists from one accepted settings section (hand-edited documents may hold raw input). */
function durableFontFamilies(section: ThemeSettings): FontFamilies {
  return Object.freeze({
    text: normalizeFontFamily(section.textFontFamily),
    code: normalizeFontFamily(section.codeFontFamily),
  })
}

/** Register desktop font-size keys when keyboard and locale services are available. */
function installFontSizeShortcuts(ctx: ClientContext, adjust: (delta: 1 | -1) => void): void {
  ctx.inject(['shortcuts', 'locale'], (scope) => {
    if (scope.shortcuts.runtime !== 'desktop') return
    const t = scope.locale.bind(SETTINGS_NS)
    const combinations: { binding: NormalizedBinding; delta: 1 | -1 }[] = []
    // Fixed bindings drive both reservation and matching.
    for (const [direction, code, delta] of [['increase', 'Equal', 1], ['decrease', 'Minus', -1]] as const) {
      const binding = { code, modifiers: ['primary'] as const }
      const bindings = direction === 'increase'
        ? [binding, { code, modifiers: ['primary', 'shift'] as const }] as const : [binding] as const
      for (const candidate of bindings) {
        combinations.push({ binding: scope.shortcuts.describeBinding(candidate).binding as NormalizedBinding, delta })
      }
      scope.effect(() => scope.shortcuts.registerFixed({
        id: `fontSize.${direction}` as ShortcutCommandId, label: () => t(`fontSize.text.${direction}`),
        keys: scope.shortcuts.describeBinding(binding).keys,
        bindings, group: 'application',
      }), `ui-theme: ${direction} font size reference`)
    }
    scope.effect(() => scope.shortcuts.observeFixedInput((input) => {
      if (input.type === 'reset') return
      const { gesture } = input
      if (gesture.composing || gesture.defaultPrevented || gesture.repeat) return
      const matched = combinations.find(({ binding }) => binding.code === gesture.code
        && (['control', 'alt', 'shift', 'meta'] as const).every(modifier => gesture[modifier] === binding.modifiers.includes(modifier)))
      if (matched === undefined) return
      input.consume()
      adjust(matched.delta)
    }), 'ui-theme: font size input')
  })
}

/**
 * Required services: settings transport plus slots/locale for the Appearance
 * row. `remote` carries the forwarded settings invalidation that
 * `ctx.configForms.get(entryId)` subscribes to on this context.
 */
export const inject = ['slots', 'locale', 'remote', 'configForms']

/**
 * Client plugin body: provide the theme service and register the
 * feature-owned Appearance row into the General section's item
 * slot (a feature owns its settings surface). Desktop font-size shortcuts share
 * text and code font sizes when the keyboard service is available.
 * @param ctx - client cordis context.
 */
export function apply(ctx: ClientContext): void {
  installThemeStyles(ctx)
  ctx.effect(() => ctx.locale.register(SETTINGS_NS, { zh, en }), 'ui-theme: settings row dictionaries')
  const host = ctx.configForms.get<ThemeSettings>(THEME_SETTINGS_NAMESPACE)
  const theme = new ThemeRuntime(ctx, host)
  ctx.provide('theme', theme)

  const store = createAppearanceRowStore()
  let bound: BoundActions<typeof store> | undefined
  const sync = (snapshot: ThemeSnapshot): void => {
    bound?.sync(snapshot.preference, snapshot.revision)
  }
  ctx.on('theme/change', sync)
  const injected = (actions: BoundActions<typeof store>): AppearanceRowInjected => {
    bound = actions
    // Re-sync from the getter so no event is lost between registration and
    // first render (the store's revision guard drops stale duplicates).
    sync(theme.getTheme())
    return {
      setTheme: (id) => { theme.setTheme(id) },
    }
  }
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'appearance',
    order: 10,
    store,
    locale: SETTINGS_NS,
    inject: injected,
  }, AppearanceRow))

}
