/**
 * Window CustomEvent names dispatched by the global shortcut dispatcher for
 * chords whose behaviour is owned by a focus-dependent surface (sidebar/editor)
 * rather than a direct store action.
 *
 * `copy-path` / `reveal-in-finder` are announced so any future focus owner can
 * react; the dispatcher also performs the active-document default itself.
 * `cycle-recent` is consumed by `useRecentDocumentCycle`, which owns the MRU
 * lookup.
 *
 * (Previously exported from `useKeyboardShortcuts.ts`; relocated here so the
 * names survive that hook's removal.)
 */
export const COPY_PATH_EVENT = "notesage:copy-path";
export const REVEAL_IN_FINDER_EVENT = "notesage:reveal-in-finder";
export const CYCLE_RECENT_EVENT = "notesage:cycle-recent";
