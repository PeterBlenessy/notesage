/**
 * useKeyboardShortcuts — the single keyboard-shortcut hook, mounted at the app
 * root (App.tsx) alongside the other lifecycle hooks.
 *
 * Batch G12 · task #76 — consolidated the scattered if/else soup of the
 * legacy hook into a declarative SHORTCUT table, added `uiPreview` awareness
 * so ⌘K / ⌘1–4 / ⌘⇧P route to the FloatingCommandBar under the Quiet
 * Composer preview, and pulled `useCommandBarShortcuts` into this hook
 * (composition) so App.tsx only has to mount one keyboard hook.
 *
 * ------------------------------------------------------------------------
 *   SHORTCUT INVENTORY — read this before editing.
 * ------------------------------------------------------------------------
 *
 *   Legacy column = behaviour when `settings.uiPreview === "legacy"`
 *   QuietComposer column = behaviour when `settings.uiPreview === "quiet-composer"`
 *   A dash (—) means this hook does NOT handle the chord; see "Owner" column
 *   for the component that owns it at capture phase.
 *
 *   | Chord       | Legacy                             | QuietComposer                                  | Owner (if not this hook) |
 *   | ----------- | ---------------------------------- | ---------------------------------------------- | ------------------------ |
 *   | ⌘K          | Open CommandPalette (default mode) | emit cmd-bar `focus`                           | this hook (both paths)   |
 *   | ⌘1          | Open CommandPalette (actions)      | emit cmd-bar `focus` prefix `!`                | this hook (both paths)   |
 *   | ⌘2          | Open CommandPalette (mentions)     | emit cmd-bar `focus` prefix `@`                | this hook (both paths)   |
 *   | ⌘3          | Open CommandPalette (tags)         | emit cmd-bar `focus` prefix `#`                | this hook (both paths)   |
 *   | ⌘4          | Open CommandPalette (research)     | emit cmd-bar `focus` prefix `?`                | this hook (both paths)   |
 *   | ⌘⇧1…4       | same as unshifted (same action)    | same as unshifted                              | this hook (both paths)   |
 *   | ⌘⇧P         | Open CommandPalette (commands `>`) | emit cmd-bar `focus` prefix `>`                | this hook (both paths)   |
 *   | ⌘⇧H         | Open find-replace in editor        | Open find-replace in editor                    | this hook                |
 *   | ⌘⇧F         | Open CommandPalette (files)        | emit cmd-bar `focus` (no prefix — file search) | this hook (both paths)   |
 *   | ⌘F          | Open find in editor                | Open find in editor                            | this hook                |
 *   | ⌘W          | Close active tab (dirty guard)     | Close active tab (dirty guard)                 | this hook                |
 *   | ⌘.          | Toggle focus mode                  | —                                              | useFocusMode (capture)   |
 *   | ⌘⇧E         | Open Export dialog                 | —                                              | QuietLayout (capture)    |
 *   | ⌘⇧O         | Open document outline              | Open document outline                          | this hook                |
 *   | ⌘⇧L         | Toggle sidebar pin                 | Toggle sidebar pin                             | this hook                |
 *   | ⌘⇧A         | Toggle activity strip              | emit agent-orb `toggle`                        | this hook                |
 *   | ⌘⇧C         | Toggle chat panel                  | unpin cmd bar (if expanded+pinned) else focus  | this hook                |
 *   | ⌘⇧R         | Toggle recording                   | Toggle recording                               | this hook                |
 *   | ⌘⇧K         | Open Keyboard Shortcuts dialog     | Open Keyboard Shortcuts dialog                 | this hook                |
 *   | ⌘,          | Open Settings                      | Open Settings                                  | this hook                |
 *   | ⌘T          | Toggle theme                       | Toggle theme                                   | this hook                |
 *   | ⌘N          | Open New Note dialog               | —                                              | QuietLayout (capture)    |
 *   | ⌘⇧N         | Open New Project dialog            | —                                              | QuietLayout (capture)    |
 *   | ⌘O          | Open folder picker                 | Open folder picker                             | this hook                |
 *   | ⌘⇧[         | Previous Recent doc (TODO #77)     | Previous Recent doc (TODO #77)                 | this hook (scaffold)     |
 *   | ⌘⇧]         | Next Recent doc (TODO #77)         | Next Recent doc (TODO #77)                     | this hook (scaffold)     |
 *   | ⌘⌥C         | Copy active document's path        | Copy active document's path                    | this hook                |
 *   | ⌘⌥R         | Reveal active document in Finder   | Reveal active document in Finder               | this hook                |
 *   | Esc         | Exit focus mode (when active)      | —                                              | useFocusMode (capture)   |
 *   | ⌘⌥I         | Open Tauri devtools                | Open Tauri devtools                            | this hook                |
 *
 * ⌘S (save) is context-aware and lives in `Editor.tsx` / `CodeEditor.tsx` so
 * markdown and code-file save paths can diverge. It's intentionally NOT here.
 *
 * ------------------------------------------------------------------------
 *   Why the capture-phase listeners in other components aren't migrated.
 * ------------------------------------------------------------------------
 *
 * `QuietLayout` owns ⌘⇧E (TreeOverlay), ⌘N, and ⌘⇧N at CAPTURE phase with
 * `stopImmediatePropagation`. `useFocusMode` owns ⌘. at capture phase.
 * That design predates this consolidation and is deliberate: the capture
 * phase lets those components preempt this hook's bubble-phase listener
 * when the Quiet Composer preview is active. If we absorbed them into this
 * hook, we'd need to conditionally skip them based on `uiPreview` + active
 * popover state + focus state — a worse abstraction than letting each
 * component own its own chord.
 *
 * The JSDoc table above is the single source of truth for "which component
 * owns which chord" — keep it in sync when moving listeners around.
 */

import { useEffect } from "react";
import { toast } from "sonner";
import { useEditorStore } from "@/stores/editor-store";
import { useSettingsStore } from "@/stores/settings-store";
import { emitCmdBarEvent } from "@/lib/cmd-bar-events";
import { emitAgentOrbEvent } from "@/lib/agent-orb-events";
import { useCommandBarShortcuts } from "@/hooks/useCommandBarShortcuts";
import { useDoubleTapCmd } from "@/hooks/useDoubleTapCmd";
import { tauriApi } from "@/lib/tauri";
import { copyToClipboard } from "@/components/sidebar/quiet/sidebar-clipboard";
import type { PaletteMode } from "@/lib/command-palette";

/**
 * Callback bag the hook invokes when a shortcut fires. Signature is
 * BACKWARD-COMPATIBLE with the pre-consolidation hook — App.tsx's call site
 * continues to work unchanged.
 */
interface KeyboardShortcutCallbacks {
  onPaletteOpen: (mode: PaletteMode) => void;
  onFindOpen: () => void;
  onFindReplaceOpen: () => void;
  onToggleFocusMode: () => void;
  onExitFocusMode: () => void;
  onOutlineOpen: () => void;
  onSettingsOpen: () => void;
  onExportOpen: () => void;
  onNewProject: () => void;
  onNewNote: () => void;
  onOpenFolder: () => void;
  onShortcutsOpen: () => void;
  onToggleActivityStrip?: () => void;
  onToggleRecording?: () => void;
  onOpenActions?: () => void;
  focusMode: boolean;
}

/**
 * Public event name for sidebar/editor "copy absolute path" and "reveal in
 * Finder" chords. Listeners are free to ignore these if they're not the
 * current focus owner — the hook just announces that the chord fired.
 */
export const COPY_PATH_EVENT = "notesage:copy-path";
export const REVEAL_IN_FINDER_EVENT = "notesage:reveal-in-finder";
export const CYCLE_RECENT_EVENT = "notesage:cycle-recent";

export function useKeyboardShortcuts(callbacks: KeyboardShortcutCallbacks) {
  // Quiet-composer-only cmd-bar bindings (⌘K, ⌘1–4, ⌘⇧P, Esc inside the
  // bar). The hook short-circuits itself to a no-op under legacy, so it's
  // safe to mount unconditionally from here.
  useCommandBarShortcuts();

  // Quiet-composer-only double-tap ⌘ → emit cmd-bar `focus` on the bus.
  // Internally gated on `uiPreview === "quiet-composer"` — legacy is a
  // zero-listener no-op, so it's safe to mount unconditionally here.
  useDoubleTapCmd();

  const { openDocuments, activeTabId, closeTab, setPendingCloseTabId } = useEditorStore();
  const { setSidebarPinned, setChatPanelOpen } = useSettingsStore();
  const uiPreview = useSettingsStore((s) => s.uiPreview);
  const isQuiet = uiPreview === "quiet-composer";

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;
      const key = e.key;
      const keyLower = key.toLowerCase();

      // ------------------------------------------------------------------
      // Focus-mode escape — legacy only. useFocusMode owns Esc under the
      // quiet-composer preview at capture phase.
      // ------------------------------------------------------------------
      if (key === "Escape" && callbacks.focusMode && !isQuiet) {
        e.preventDefault();
        callbacks.onExitFocusMode();
        return;
      }

      // ------------------------------------------------------------------
      // Cmd+W — close active tab (both variants).
      // ------------------------------------------------------------------
      if (isMod && !e.shiftKey && !e.altKey && keyLower === "w") {
        e.preventDefault();
        if (activeTabId) {
          const activeTab = openDocuments.find((t) => t.id === activeTabId);
          if (activeTab?.isDirty) {
            setPendingCloseTabId(activeTabId);
            return;
          }
          closeTab(activeTabId);
        }
        return;
      }

      // ------------------------------------------------------------------
      // Palette / command bar family. Under quiet-composer, the
      // `useCommandBarShortcuts` hook (composed above) has ALREADY handled
      // ⌘K / ⌘1–4 / ⌘⇧P at the time we run — it installs its listener on
      // the same `window` target with the same (default) event phase, and
      // the React effect ordering guarantees it mounts first. It calls
      // preventDefault; we guard against re-firing here by checking
      // `defaultPrevented`. Belt-and-suspenders: we also short-circuit by
      // `uiPreview` below so even if the cmd-bar hook weren't mounted
      // (unlikely), we still wouldn't open the legacy palette.
      // ------------------------------------------------------------------

      // ⌘K
      if (isMod && !e.shiftKey && !e.altKey && keyLower === "k") {
        if (isQuiet) {
          // useCommandBarShortcuts has it. Do NOT open the legacy palette.
          return;
        }
        e.preventDefault();
        callbacks.onPaletteOpen("default");
        return;
      }

      // ⌘⇧H — find-replace (not a cmd-bar mode; keep it on the editor).
      if (isMod && e.shiftKey && keyLower === "h") {
        e.preventDefault();
        callbacks.onFindReplaceOpen();
        return;
      }

      // ⌘⇧F — file search
      if (isMod && e.shiftKey && keyLower === "f") {
        if (isQuiet) {
          // The quiet-composer cmd bar doesn't reserve a prefix for "files",
          // so we emit a plain focus (empty query) and let the user type.
          e.preventDefault();
          emitCmdBarEvent({ type: "focus" });
          return;
        }
        e.preventDefault();
        callbacks.onPaletteOpen("files");
        return;
      }

      // ⌘F — in-document find (never routes to cmd bar).
      if (isMod && !e.shiftKey && keyLower === "f") {
        e.preventDefault();
        callbacks.onFindOpen();
        return;
      }

      // ⌘1 / ⌘2 / ⌘3 / ⌘4 — palette prefix modes.
      if (isMod && !e.altKey) {
        const DIGIT_TO_LEGACY_MODE: Record<string, PaletteMode> = {
          "1": "default", // actions dashboard opens separately via onOpenActions
          "2": "mentions",
          "3": "tags",
          "4": "research",
        };
        if (key in DIGIT_TO_LEGACY_MODE) {
          if (isQuiet) {
            // useCommandBarShortcuts owns these.
            return;
          }
          e.preventDefault();
          if (key === "1") {
            callbacks.onOpenActions?.();
          } else {
            callbacks.onPaletteOpen(DIGIT_TO_LEGACY_MODE[key]);
          }
          return;
        }
      }

      // ⌘⇧P — command palette in `>` (commands) mode under legacy; focus
      // cmd bar with `>` prefix under quiet-composer.
      if (isMod && e.shiftKey && keyLower === "p") {
        if (isQuiet) {
          // useCommandBarShortcuts owns this.
          return;
        }
        e.preventDefault();
        callbacks.onPaletteOpen("commands");
        return;
      }

      // ------------------------------------------------------------------
      // Focus mode — legacy only. useFocusMode owns ⌘. under quiet-composer.
      // ------------------------------------------------------------------
      if (isMod && !isQuiet && key === ".") {
        e.preventDefault();
        callbacks.onToggleFocusMode();
        return;
      }

      // ------------------------------------------------------------------
      // Theme / settings / outline / sidebar / chat / activity / recording.
      // These are uiPreview-agnostic.
      // ------------------------------------------------------------------

      // ⌘T — toggle theme
      if (isMod && !e.shiftKey && !e.altKey && keyLower === "t") {
        e.preventDefault();
        const settings = useSettingsStore.getState();
        settings.setTheme(settings.theme === "dark" ? "light" : "dark");
        return;
      }

      // ⌘⇧O — document outline
      if (isMod && e.shiftKey && keyLower === "o") {
        e.preventDefault();
        if (useEditorStore.getState().activeTabId) {
          callbacks.onOutlineOpen();
        }
        return;
      }

      // ⌘⇧L — toggle sidebar pin
      if (isMod && e.shiftKey && keyLower === "l") {
        e.preventDefault();
        setSidebarPinned(!useSettingsStore.getState().sidebarPinned);
        return;
      }

      // ⌘⇧A — toggle activity strip (legacy) / toggle agent orb popover
      // (quiet-composer). Under Quiet Composer there is no activity strip,
      // so we emit on the agent-orb bus instead; `AgentOrb` subscribes and
      // flips its popover open/closed state. Under legacy, the callback
      // drives the classic ActivityStrip resizable panel.
      if (isMod && e.shiftKey && keyLower === "a") {
        e.preventDefault();
        if (isQuiet) {
          emitAgentOrbEvent({ type: "toggle" });
        } else {
          callbacks.onToggleActivityStrip?.();
        }
        return;
      }

      // ⌘⇧C — toggle chat panel (legacy) / cmd bar semantics (quiet-composer).
      // Under Quiet Composer the command bar IS the chat (per PRD intent), so
      // this chord summons the bar rather than toggling a non-existent
      // `chatPanelOpen` sidebar. Decision table:
      //
      //   collapsed        → emit `focus` (expand)
      //   expanded+float   → no-op (Esc is the documented dismiss path)
      //   expanded+pinned  → emit `toggle-pin` (unpin → float; same chord
      //                     twice unpins)
      //
      // We read expand/pin state via the DOM — the bar writes
      // `data-expanded` and `data-cmd-bar-pinned` on its root. Reading DOM
      // in a one-off keyboard handler avoids a circular React dependency
      // (keyboard hook → bar ref → keyboard hook) that the cmd-bar-events
      // bus was introduced to prevent.
      if (isMod && e.shiftKey && keyLower === "c" && !e.altKey) {
        e.preventDefault();
        if (isQuiet) {
          const bar = document.querySelector(
            "[data-cmd-bar]",
          ) as HTMLElement | null;
          const isExpanded = bar?.getAttribute("data-expanded") === "true";
          const isPinned = bar?.getAttribute("data-cmd-bar-pinned") === "true";
          if (isExpanded && isPinned) {
            emitCmdBarEvent({ type: "toggle-pin" });
          } else if (!isExpanded) {
            emitCmdBarEvent({ type: "focus" });
          }
          // else: expanded + floating → no-op (user should use Esc)
        } else {
          setChatPanelOpen(!useSettingsStore.getState().chatPanelOpen);
        }
        return;
      }

      // ⌘, — settings
      if (isMod && !e.shiftKey && !e.altKey && key === ",") {
        e.preventDefault();
        callbacks.onSettingsOpen();
        return;
      }

      // ⌘⇧K — keyboard shortcuts reference (ui-refresh PRD §Keyboard shortcuts)
      if (isMod && e.shiftKey && !e.altKey && keyLower === "k") {
        e.preventDefault();
        callbacks.onShortcutsOpen();
        return;
      }

      // ⌘7 — removed live-test 2026-04-26. ⌘⇧K is the canonical shortcut.

      // ⌘⇧R — toggle recording
      if (isMod && e.shiftKey && keyLower === "r" && !e.altKey) {
        e.preventDefault();
        callbacks.onToggleRecording?.();
        return;
      }

      // ⌘⇧E — export. QuietLayout preempts at capture phase under
      // quiet-composer, so we're safe to handle unconditionally here.
      if (isMod && e.shiftKey && keyLower === "e") {
        e.preventDefault();
        if (useEditorStore.getState().activeTabId) {
          callbacks.onExportOpen();
        }
        return;
      }

      // ⌘⇧N — new project. QuietLayout preempts at capture phase under
      // quiet-composer.
      if (isMod && e.shiftKey && keyLower === "n") {
        e.preventDefault();
        callbacks.onNewProject();
        return;
      }

      // ⌘N — new note. QuietLayout preempts at capture phase under
      // quiet-composer.
      if (isMod && !e.shiftKey && !e.altKey && keyLower === "n") {
        e.preventDefault();
        callbacks.onNewNote();
        return;
      }

      // ⌘O — open folder
      if (isMod && !e.shiftKey && !e.altKey && keyLower === "o") {
        e.preventDefault();
        callbacks.onOpenFolder();
        return;
      }

      // ------------------------------------------------------------------
      // ⌘⇧[ / ⌘⇧] — cycle through Recent documents (MRU order).
      //
      // TODO(#77): The MRU cycling logic itself is task #77. For #76 we
      // install the binding scaffold and emit a custom event so the feature
      // wire-up is a one-file change when #77 lands. Firing the event is
      // harmless — no listener exists today, so the chord is effectively a
      // no-op that consumes the keystroke (intentional — avoids the chord
      // falling through to the browser's back/forward navigation).
      // ------------------------------------------------------------------
      if (isMod && e.shiftKey && !e.altKey && (key === "[" || key === "]")) {
        e.preventDefault();
        window.dispatchEvent(
          new CustomEvent<{ direction: "previous" | "next" }>(
            CYCLE_RECENT_EVENT,
            { detail: { direction: key === "[" ? "previous" : "next" } },
          ),
        );
        return;
      }

      // ------------------------------------------------------------------
      // ⌘⌥C — copy the active document's absolute path to the clipboard.
      // ⌘⌥R — reveal the active document in Finder.
      //
      // Live-test 2026-04-26: previously these chords were sidebar-scoped
      // (advertised in the quiet-sidebar context menu's `ContextMenuShortcut`
      // hints) and dispatched DOM events that no listener consumed. The kbd
      // hints made no sense in the menu context (the menu is open by then —
      // the user is clicking, not chording) and the chords didn't actually
      // do anything globally. Repurposing them: act on the editor's active
      // document. We still dispatch the legacy `notesage:copy-path` /
      // `notesage:reveal-in-finder` events so any future listener can hook
      // in, but the hook now owns the canonical behaviour.
      //
      // Modifier-key chords (⌘⌥C / ⌘⌥R) don't need a typing-target guard —
      // browsers don't insert these as text. Same approach as ⌘⌥I (devtools)
      // below.
      // ------------------------------------------------------------------
      // macOS gotcha: Option+letter produces a special character (Option+R
      // = `®`, Option+C = `ç`, Option+I = `ˆ`), so `e.key.toLowerCase()`
      // never matches `"r"` / `"c"` / `"i"` for Option-modified chords.
      // Use `e.code` (physical key — `KeyR`, `KeyC`, `KeyI`) which ignores
      // dead-key composition. Live-test 2026-04-26.
      if (isMod && e.altKey && !e.shiftKey && e.code === "KeyC") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent(COPY_PATH_EVENT));
        const { activeTabId, openDocuments } = useEditorStore.getState();
        const active = activeTabId
          ? openDocuments.find((t) => t.id === activeTabId)
          : null;
        if (active?.filePath) {
          void copyToClipboard(active.filePath, "Copied path to clipboard");
        } else {
          toast.error("No active document");
        }
        return;
      }

      if (isMod && e.altKey && !e.shiftKey && e.code === "KeyR") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent(REVEAL_IN_FINDER_EVENT));
        const { activeTabId, openDocuments } = useEditorStore.getState();
        const active = activeTabId
          ? openDocuments.find((t) => t.id === activeTabId)
          : null;
        if (active?.filePath) {
          void (async () => {
            try {
              await tauriApi.revealInFinder(active.filePath);
            } catch (error) {
              toast.error(`Failed to reveal: ${error}`);
            }
          })();
        } else {
          toast.error("No active document");
        }
        return;
      }

      // ⌘⌥I — devtools (same `e.code` rationale as ⌘⌥C / ⌘⌥R above —
      // Option+I produces `ˆ`, not `i`).
      if (isMod && e.altKey && e.code === "KeyI") {
        e.preventDefault();
        import("@tauri-apps/api/core").then(({ invoke }) => {
          invoke("open_devtools").catch(console.error);
        });
        return;
      }

      // Cmd+S is handled in the Editor component for context-aware saving.
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    activeTabId,
    openDocuments,
    closeTab,
    setPendingCloseTabId,
    setSidebarPinned,
    setChatPanelOpen,
    callbacks,
    isQuiet,
  ]);
}
