import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import { IconCheckOutlineRegular } from './icons/index.tsx'
import { overlayTopMargin } from './overlay-top-margin.ts'
import { isBehindModal } from './useModalLayer.ts'
import { observeComposition } from './keyboard-composition.ts'
import { focusWithoutRing } from './focus.ts'
import { MenuSurface } from './MenuSurface.tsx'
import css from './Menu.module.css'

/** Selectable data row. */
export interface MenuItem {
  id: string
  label: ReactNode
  disabled?: boolean
  /** Leading icon (figma .Menu_cell gap 8). */
  icon?: ReactNode
}

/** Props for one component-rendered menu row. */
export interface MenuItemButtonProps {
  /** Visible row label. */
  children: ReactNode
  /** Leading icon (figma .Menu_cell gap 8). */
  icon?: ReactNode
  /** Row activation (click, Enter, or Tab on the focused row). */
  onSelect: () => void
}

/**
 * Render one `role="menuitem"` row for a {@link Menu} whose rows are
 * components rather than `items` data: the same markup and styling as a data
 * row, so it joins the list's keyboard walk and post-selection focus return
 * without any shared state. Closing the menu stays the owner's decision, as
 * it is for data rows.
 * @param props.children - visible row label.
 * @param props.icon - optional leading icon.
 * @param props.onSelect - row activation callback.
 * @returns one menu-item row.
 */
export function MenuItemButton({
  children, icon, onSelect,
}: MenuItemButtonProps) {
  return (
    <div className={css.itemWrap}>
      <button
        type="button"
        role="menuitem"
        className={css.item}
        onClick={onSelect}
      >
        {icon !== undefined && <span className={css.itemIcon}>{icon}</span>}
        <span className={css.itemLabel}>{children}</span>
      </button>
    </div>
  )
}

/** Unplaced portal list: hidden but laid out at a fixed origin so offsetWidth/offsetHeight are real. */
const MEASURE_STYLE: CSSProperties = { visibility: 'hidden', left: 0, top: 0 }

/** Anchored menu with native keyboard traversal, modal isolation and focus return. */
export function Menu({ open, anchor, items = [], children, selectedId, onSelect, onClose, align = 'start', side = 'bottom', portal = false, autoFocus = false, className, listClassName }: {
  open: boolean
  autoFocus?: boolean
  anchor: ReactNode
  items?: readonly MenuItem[]
  children?: ReactNode
  selectedId?: string | undefined
  onSelect?: (id: string) => void
  onClose: () => void
  align?: 'start' | 'end'
  side?: 'bottom' | 'top'
  portal?: boolean
  className?: string | undefined
  listClassName?: string | undefined
}) {
  const rootRef = useRef<HTMLSpanElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  /** Index the arrow walk last focused, the resume point when focus left the rows. */
  const walkIndex = useRef<number | null>(null)
  /**
   * The control that had the keyboard when this menu opened — its own trigger,
   * which an anchor that wraps several controls (a split button) would not be
   * able to name by position.
   */
  const triggerRef = useRef<HTMLElement | null>(null)
  const selectingWithTab = useRef(false)

  /**
   * Hand the keyboard back to the trigger that opened the menu — or, when the
   * anchor never held it, to the anchor's first button. Focus left on a removed
   * row otherwise falls to the page body, where the next Tab restarts from the
   * top of the page.
   * @param navigation - whether explicit keyboard traversal should retain its focus indicator.
   */
  const refocusAnchor = (navigation = false): void => {
    const trigger = triggerRef.current
    const target = trigger !== null && document.contains(trigger) && !(trigger as HTMLButtonElement).disabled
      ? trigger : rootRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')
    if (target == null) return
    if (navigation) target.focus()
    else focusWithoutRing(target)
  }

  /**
   * Post-selection focus, for the paths where the rows unmount with the list.
   * A selection whose owner keeps the menu open is left alone, and so is an
   * owner that moved focus itself (a presented file card hands it to its
   * preview button): only a keyboard left on the closing list (or on the body
   * its removal produced) comes back to the trigger.
   */
  const refocusAfterSelection = (): void => {
    const navigation = selectingWithTab.current
    queueMicrotask(() => {
      if (openRef.current) return
      const active = document.activeElement
      if (active === null || active === document.body || listRef.current?.contains(active) === true) refocusAnchor(navigation)
    })
  }
  const openRef = useRef(open)
  openRef.current = open
  const [fixedPos, setFixedPos] = useState<CSSProperties | null>(null)

  // Portal mode: fixed-position the list from the anchor rect before paint;
  // track the anchor while open (capture-phase scroll catches nested panes).
  useLayoutEffect(() => {
    if (!open || !portal) { setFixedPos(null); return }
    const place = () => {
      const r = rootRef.current?.getBoundingClientRect()
      if (r === undefined) return
      const MARGIN = 12
      const vw = window.innerWidth
      const vh = window.innerHeight
      const listEl = listRef.current
      const lw = listEl?.offsetWidth ?? 0
      const lh = listEl?.offsetHeight ?? 0

      let x: number
      let y: number
      if (align === 'start') {
        x = r.left
        y = side === 'bottom' ? r.bottom + 4 : r.top - lh - 4
      } else {
        x = r.right - lw
        y = side === 'bottom' ? r.bottom + 4 : r.top - lh - 4
      }

      if (lw > 0) x = Math.min(Math.max(x, MARGIN), vw - lw - MARGIN)
      if (lh > 0) y = Math.min(Math.max(y, overlayTopMargin(MARGIN)), vh - lh - MARGIN)

      setFixedPos(current => current?.left === x && current.top === y ? current : { left: x, top: y })
    }
    // First run measures the hidden pre-render (same commit as `open`), so
    // end/top alignment and clamping use real dimensions before anything
    // paints — no visible jump from a zero-size first guess.
    place()
    // Dragging or transforming an ancestor moves the anchor without a scroll or resize event.
    const track = () => {
      place()
      frame = requestAnimationFrame(track)
    }
    let frame = requestAnimationFrame(track)
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [open, portal, align, side])

  // Opening remembers where the keyboard was, so closing can hand it back to
  // that control — an anchor wrapping several (a split button) cannot be asked
  // for it by position. Declared before the autoFocus effect so the capture
  // sees the trigger, not the row autoFocus is about to focus.
  useEffect(() => {
    if (!open) {
      triggerRef.current = null
      return
    }
    const active = document.activeElement
    triggerRef.current = active instanceof HTMLElement && rootRef.current?.contains(active) === true ? active : null
  }, [open])

  const placed = !portal || fixedPos !== null
  useEffect(() => {
    if (!open || !autoFocus || !placed) return
    const first = listRef.current?.querySelector<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled)')
    walkIndex.current = first?.tagName === 'BUTTON' ? 0 : null
    if (first != null) focusWithoutRing(first)
  }, [open, autoFocus, placed])

  useEffect(() => {
    if (!open) {
      walkIndex.current = null
      return
    }
    const composition = observeComposition(document)
    const onPointerDown = (e: PointerEvent) => {
      if (!(e.target instanceof Node)) return
      // The portaled list is outside the anchor subtree; check both.
      if (rootRef.current?.contains(e.target) === true) return
      if (listRef.current?.contains(e.target) === true) return
      onClose()
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (composition.guards(e) || isBehindModal(rootRef.current) || e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey) return
      // Where the keyboard is, computed once: the menu owns it when it holds a
      // row or sits on its anchor region.
      const focused = document.activeElement
      const insideList = listRef.current?.contains(focused) === true
      const anchored = rootRef.current?.contains(focused) === true || insideList
      if (e.key === 'Escape' && !e.shiftKey) {
        e.preventDefault()
        if (e.repeat) return
        // Closing hands the keyboard back when the menu had it — and, as this
        // primitive always did for autoFocus menus, when it held the keyboard
        // and lost it again (a row that unmounted under it).
        onClose()
        if (anchored || autoFocus) refocusAnchor()
      }
      // Tab settles like Enter and Shift+Tab leaves like Escape, so a menu's
      // keys mean what they mean in the composer. Only a keyboard already on
      // the trigger or inside the list is intercepted: Tab elsewhere on the
      // page keeps the browser's traversal even while a menu is open.
      if (e.key === 'Tab') {
        const list = listRef.current
        if (list === null || !anchored) return
        if (e.shiftKey) {
          e.preventDefault()
          onClose()
          refocusAnchor(true)
          return
        }
        // Tab settles the row it is on; from anywhere else in the menu region
        // it enters the list. A focused control that is not a row (a retry
        // button inside an error strip) and a list with no enabled row keep the
        // browser's traversal instead of being swallowed.
        if (insideList) {
          if (focused instanceof Element && focused.getAttribute('role') === 'menuitem') {
            e.preventDefault()
            selectingWithTab.current = true
            try { (focused as HTMLElement).click() }
            finally { selectingWithTab.current = false }
          }
          return
        }
        const row = list.querySelector<HTMLButtonElement>('button:not(:disabled)')
        if (row === null) return
        e.preventDefault()
        row.focus()
        walkIndex.current = 0
        return
      }
      // Arrows walk the list whether or not the menu focused its first item on
      // open, so `autoFocus` chooses only that entry behavior. A keyboard still
      // on the anchor enters at the end the step comes from — unless it already
      // walked, in which case the walk resumes where it left off. The walk resumes
      // from where it last put focus, not from `document.activeElement`: a row
      // that refused focus (a hidden portal frame, a detached node) would
      // otherwise re-enter at the near end on every press and the walk would
      // alternate between two rows.
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
      const list = listRef.current
      if (list === null || !anchored) return
      const buttons = Array.from(list.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
      if (buttons.length === 0) return
      const index = buttons.indexOf(focused as HTMLButtonElement)
      const from = index >= 0 ? index : walkIndex.current
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1
        : from === null
          ? (e.key === 'ArrowDown' ? 0 : buttons.length - 1)
          : (from + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
      e.preventDefault()
      walkIndex.current = next
      buttons[next]?.focus()
    }
    // A pointerdown inside a cross-origin iframe (a sandboxed HTML preview)
    // never reaches this document; the focus move it causes blurs the window
    // instead. Only that case closes: an app or tab switch leaves the
    // document's focus where it was, so activeElement is not an iframe.
    const onWindowBlur = () => {
      if (document.activeElement instanceof HTMLIFrameElement) onClose()
    }
    document.addEventListener('pointerdown', onPointerDown)
    const onEscape = (event: KeyboardEvent): void => { if (event.key === 'Escape') onKeyDown(event) }
    const onOtherKey = (event: KeyboardEvent): void => { if (event.key !== 'Escape') onKeyDown(event) }
    document.addEventListener('keydown', onOtherKey)
    document.addEventListener('keydown', onEscape, true)
    window.addEventListener('blur', onWindowBlur)
    return () => {
      composition.dispose()
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onOtherKey)
      document.removeEventListener('keydown', onEscape, true)
      window.removeEventListener('blur', onWindowBlur)
    }
  }, [open, onClose, autoFocus])

  const renderEntry = (entry: MenuItem) => {
    const selected = entry.id === selectedId
    return (
      <div
        key={entry.id}
        className={css.itemWrap}
      >
        <button
          type="button"
          role="menuitem"
          className={clsx(css.item, selected && css.selected)}
          disabled={entry.disabled}
          onClick={() => { onSelect?.(entry.id) }}
        >
          {entry.icon !== undefined && <span className={css.itemIcon}>{entry.icon}</span>}
          <span className={css.itemLabel}>{entry.label}</span>
          {selected && <IconCheckOutlineRegular className={css.check} />}
        </button>
      </div>
    )
  }

  // Measure portal lists while hidden so the first painted frame is positioned.
  const list = open && (
    <MenuSurface
      ref={listRef}
      className={clsx(css.list, listClassName, css.scrollable, portal && css.portal, side === 'top' && !portal && css.sideTop, align === 'end' && !portal && css.alignEnd)}
      style={portal ? fixedPos ?? MEASURE_STYLE : undefined}
      role="menu"
      // React portals bubble synthetic events through the REACT tree: without
      // this stop, an item click re-fires the anchor row's own onClick
      // (open/toggle) after onSelect. The same bubble is where every row's
      // activation lands — data rows and component rows alike — so the
      // post-selection focus return is decided once here, after the row's
      // own handler ran.
      onClick={(e) => {
        e.stopPropagation()
        const row = e.target instanceof Element ? e.target.closest('button[role="menuitem"]') : null
        if (row !== null) refocusAfterSelection()
      }}
    >
      <div className={css.viewport} role="presentation">
        {items.map(renderEntry)}
        {children}
      </div>
    </MenuSurface>
  )

  return (
    <span
      ref={rootRef}
      className={clsx(css.root, className)}
    >
      {anchor}
      {portal ? (list !== false && createPortal(list, document.body)) : list}
    </span>
  )
}
