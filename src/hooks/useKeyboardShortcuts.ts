/**
 * useKeyboardShortcuts — the single keyboard-shortcut hook, mounted at the app
 * root (App.tsx) alongside the other lifecycle hooks.
 *
 * Shortcut inventory → `src/shared/appCommandManifest.json` (single source
 * of truth for ids, chords, and display strings). The manifest is keyed by
 * `id` in the typed catalog `src/lib/appCommandCatalog.ts`.
 *
 * Owner table (which component handles each chord) is in
 * `docs/keyboard-shortcuts.md` — update both that doc and the manifest when
 * adding or moving a chord.
 *
 * ⌘S (save) is context-aware and lives in `Editor.tsx` / `CodeEditor.tsx` so
 * markdown and code-file save paths can diverge. It is intentionally absent
 * from the manifest.
 *
 * Why the capture-phase listeners in other components aren't migrated:
 *
 * `QuietLayout` owns ⌘N and ⌘⇧N at CAPTURE phase with
 * `stopImmediatePropagation`. `useFocusMode` owns ⌘. at capture phase.
 * That design predates this consolidation and is deliberate: the capture
 * phase lets those components preempt this hook's bubble-phase listener.
 */

import { useEffect } from "react";
import { toast } from "sonner";
import { useEditorStore } from "@/stores/editor-store";
import { useSettingsStore } from "@/stores/settings-store";
import { emitCmdBarEvent } from "@/lib/cmd-bar-events";
import { emitAgentOrbEvent } from "@/lib/agent-orb-events";
import { useCommandBarShortcuts } from "@/hooks/useCommandBarShortcuts";
import { useDoubleTapCmd } from "@/hooks/useDoubleTapCmd";
import { fireZoom } from "@/hooks/useEditorZoom";
import { tauriApi } from "@/lib/tauri";
import { copyToClipboard } from "@/components/sidebar/quiet/sidebar-clipboard";

interface KeyboardShortcutCallbacks {
  onFindOpen: () => void;
  onFindReplaceOpen: () => void;
  onOutlineOpen: () => void;
  onSettingsOpen: () => void;
  onExportOpen: () => void;
  onNewProject: () => void;
  onNewNote: () => void;
  onOpenFolder: () => void;
  onShortcutsOpen: () => void;
  onToggleRecording?: () => void;
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
  // Cmd-bar bindings (⌘K, ⌘1–4, ⌘⇧P, Esc inside the bar).
  useCommandBarShortcuts();

  // Double-tap ⌘ → emit cmd-bar `focus` on the bus.
  useDoubleTapCmd();

  const { openDocuments, activeTabId, closeTab, setPendingCloseTabId } = useEditorStore();
  const { setSidebarPinned } = useSettingsStore();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;
      const key = e.key;
      const keyLower = key.toLowerCase();

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
      // Palette / command bar family. useCommandBarShortcuts (composed
      // above) owns ⌘K / ⌘1–4 / ⌘⇧P and handles them directly.
      // ------------------------------------------------------------------

      // ⌘⇧H — find-replace (not a cmd-bar mode; keep it on the editor).
      if (isMod && e.shiftKey && keyLower === "h") {
        e.preventDefault();
        callbacks.onFindReplaceOpen();
        return;
      }

      // ⌘⇧F — file search → seed the cmd bar with `:file ` so the
      // FileMode picker opens with the cursor in the filter slot.
      // The trailing space is intentional — the bar's `focus` subscriber
      // treats this prefix as chord-seeded so the first Esc collapses it.
      if (isMod && e.shiftKey && keyLower === "f") {
        e.preventDefault();
        emitCmdBarEvent({ type: "focus", prefix: ":file " });
        return;
      }

      // ⌘F — in-document find (never routes to cmd bar).
      if (isMod && !e.shiftKey && keyLower === "f") {
        e.preventDefault();
        callbacks.onFindOpen();
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

      // ⌘⇧A — toggle agent orb popover. Emits on the agent-orb bus;
      // `AgentOrb` subscribes and flips its popover open/closed state.
      if (isMod && e.shiftKey && keyLower === "a") {
        e.preventDefault();
        emitAgentOrbEvent({ type: "toggle" });
        return;
      }

      // ⌘⇧C — cmd bar semantics. Decision table:
      //   collapsed        → emit `focus` (expand)
      //   expanded+float   → no-op (Esc is the documented dismiss path)
      //   expanded+pinned  → emit `toggle-pin` (unpin → float)
      //
      // We read expand/pin state via the DOM — the bar writes
      // `data-expanded` and `data-cmd-bar-pinned` on its root. Reading DOM
      // in a one-off keyboard handler avoids a circular React dependency
      // (keyboard hook → bar ref → keyboard hook) that the cmd-bar-events
      // bus was introduced to prevent.
      if (isMod && e.shiftKey && keyLower === "c" && !e.altKey) {
        e.preventDefault();
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
        return;
      }

      // ⌘, — settings
      // Cross-keyboard layout safety — `event.code === "Comma"` alongside
      // `event.key === ","` defends against layouts where the comma
      // physical key produces a different character (matches the
      // `isContextMenuKey` pattern in `useSidebarItemShortcuts`).
      if (isMod && !e.shiftKey && !e.altKey && (key === "," || e.code === "Comma")) {
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

      // ⌘⇧E — Open Export dialog (multi-format: PDF / DOCX / PPTX /
      // HTML). Sidebar-simplification task #22 — the capture-phase
      // preempt that QuietLayout used to install for TreeOverlay was
      // deleted in #20, so this handler is the sole owner of the chord.
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
      // ⌃Tab / ⌃⇧Tab — cycle through Recent documents (MRU order).
      //
      // Mirrors VS Code's exact MRU-cycle chord. Picked over the previous
      // ⌘⇧[ / ⌘⇧] binding (replaced 2026-04-28) because brackets require
      // Option to type on Swedish (and many European) layouts, making the
      // chord physically awkward even with an event.code fallback. Tab is
      // a dedicated physical key on every keyboard — no layout dependency.
      //
      // The MRU cycling logic itself lives in `useRecentDocumentCycle`
      // (Phase 1 task #77). This handler dispatches the cycle event;
      // the consumer hook does the lookup.
      //
      // Note on macOS app-switcher: a long-press of ⌃Tab (>0.5s) opens
      // the system app-switcher. A quick tap fires keydown first and
      // we preventDefault, so the system never sees the chord.
      // ------------------------------------------------------------------
      if (e.ctrlKey && !e.metaKey && !e.altKey && key === "Tab") {
        // Defense in depth: gate on `ctrlKey && !metaKey` directly —
        // never intercept ⌘Tab (macOS app-switcher).
        e.preventDefault();
        window.dispatchEvent(
          new CustomEvent<{ direction: "previous" | "next" }>(
            CYCLE_RECENT_EVENT,
            { detail: { direction: e.shiftKey ? "previous" : "next" } },
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

      // ------------------------------------------------------------------
      // ⌘+ / ⌘= — increase editor view-zoom (issue #162).
      // ⌘-   — decrease editor view-zoom.
      // ⌘0   — reset editor view-zoom to 1.0.
      //
      // These are transient: they layer a multiplier on top of the persisted
      // font size without touching editor-styles-store. The zoom resets to
      // 1.0 on app restart.
      //
      // Key notes:
      //  - `+` requires Shift on US keyboards (Shift+=), so we match both
      //    `key === "+"` and `key === "="` (the unshifted physical key).
      //  - `-` and `0` have no layout ambiguity on any supported keyboard.
      //  - No `!e.shiftKey` guard on `=` because Shift+= is how you type `+`
      //    on US; we accept either with or without Shift when key is `+`/`=`.
      // ------------------------------------------------------------------
      if (isMod && !e.altKey && (e.key === "+" || e.key === "=")) {
        e.preventDefault();
        fireZoom("in");
        return;
      }

      if (isMod && !e.altKey && !e.shiftKey && e.key === "-") {
        e.preventDefault();
        fireZoom("out");
        return;
      }

      if (isMod && !e.altKey && !e.shiftKey && e.key === "0") {
        e.preventDefault();
        fireZoom("reset");
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
    callbacks,
  ]);
}
