/** DOM markers shared by the window drag stylesheet and geometry-recall watcher. */

/**
 * The attribute a chrome row puts on the element that owns its window drag.
 * ui-web `base.css` turns the mark into the one darwin drag rule, so the row's
 * own box is the window's draggable geometry.
 */
export const DRAG_MARK = 'data-window-drag'

/**
 * The attribute the shell sets for one frame to make Electron recollect the
 * window's drag rects (electron#32341). While it is set, ui-web `base.css`
 * subtracts the marked box; the row marks inside it still declare drag and win in
 * document order, so the mark's only effect is that app-region values changed.
 */
export const RECALL_MARK = 'data-window-drag-recall'
