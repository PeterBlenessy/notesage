/**
 * shortcutActions — the behaviour bound to each global-scope command id in the
 * manifest. Kept separate from `appCommandManifest.json` because actions are
 * closures over stores, callbacks, and the cmd-bar summon store, which cannot
 * live in serializable JSON.
 *
 * The App-root dispatcher (`useGlobalShortcuts`) looks up `shortcutActions[id]`
 * for each matched manifest command and runs it. Every global-scope command has
 * an action here (incl. ⌘N/⌘⇧N and focus mode, which the dispatcher runs at
 * capture phase). Editor-owned chords (⌘S, formatting) are not in the manifest.
 *
 * The `shortcutActions` ↔ manifest correspondence is locked by a test
 * (`shortcutActions.test.ts`) so the two can never silently drift.
 */
import { toast } from "sonner";

import { useEditorStore } from "@/stores/editor-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useCmdBarSummonStore } from "@/stores/cmd-bar-summon-store";
import { resolveCreateParent } from "@/lib/workspace/resolve-create-parent";
import { emitAgentOrbEvent } from "@/lib/agent-orb-events";
import { fireZoom } from "@/hooks/useEditorZoom";
import { isAlphaBuild } from "@/lib/build-channel";
import { getFocusModeController } from "@/hooks/shortcuts/focus-mode-controller";
import { tauriApi } from "@/lib/tauri";
import { copyToClipboard } from "@/components/sidebar/quiet/sidebar-clipboard";
import {
  COPY_PATH_EVENT,
  REVEAL_IN_FINDER_EVENT,
  CYCLE_RECENT_EVENT,
} from "@/lib/keyboard/shortcut-events";

/** Callbacks supplied by App.tsx for chords that drive React-owned dialogs. */
export interface ShortcutCallbacks {
  onFindOpen: () => void;
  onFindReplaceOpen: () => void;
  onOutlineOpen: () => void;
  onSettingsOpen: () => void;
  onExportOpen: () => void;
  onNewProject: () => void;
  /** Create a new note. `parentPath` (when provided) is the directory to
   *  create it in — ⌘N passes the active document's directory. */
  onNewNote: (parentPath?: string) => void;
  onOpenFolder: () => void;
  onShortcutsOpen: () => void;
  onToggleRecording?: () => void;
}

export interface ShortcutActionContext {
  callbacks: ShortcutCallbacks;
  event: KeyboardEvent;
}

export type ShortcutAction = (ctx: ShortcutActionContext) => void;

/** Summon the command bar via the durable store (survives a bar crash). */
function summon(prefix?: string): void {
  useCmdBarSummonStore.getState().summon(prefix ? { prefix } : {});
}

/** Dispatch the MRU document-cycle event; `useRecentDocumentCycle` consumes it. */
function emitCycleRecent(direction: "next" | "previous"): void {
  window.dispatchEvent(
    new CustomEvent<{ direction: "previous" | "next" }>(CYCLE_RECENT_EVENT, {
      detail: { direction },
    }),
  );
}

function copyActiveDocumentPath(): void {
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
}

function revealActiveDocument(): void {
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
}

export const shortcutActions: Record<string, ShortcutAction> = {
  // ── Command-bar summons (durable store) ──────────────────────────────
  "open-command-palette": () => summon(),
  "open-tasks": () => summon("!"),
  "open-mentions": () => summon("@"),
  "open-tags": () => summon("#"),
  "open-research": () => summon("?"),
  "open-commands-palette": () => summon(">"),
  // ⌘⇧F seeds `:file ` (trailing space intentional — chord-seeded so the
  // first Esc collapses the bar).
  "find-files": () => summon(":file "),

  // ── Find / replace (editor-owned dialogs) ────────────────────────────
  "find-in-document": ({ callbacks }) => callbacks.onFindOpen(),
  "find-replace": ({ callbacks }) => callbacks.onFindReplaceOpen(),

  // ── Document / workspace ─────────────────────────────────────────────
  "close-active-document": () => {
    const { activeTabId, openDocuments, closeTab, setPendingCloseTabId } =
      useEditorStore.getState();
    if (!activeTabId) return;
    const activeTab = openDocuments.find((t) => t.id === activeTabId);
    if (activeTab?.isDirty) {
      setPendingCloseTabId(activeTabId);
      return;
    }
    closeTab(activeTabId);
  },
  "export-document": ({ callbacks }) => {
    if (useEditorStore.getState().activeTabId) callbacks.onExportOpen();
  },
  "open-document-outline": ({ callbacks }) => {
    if (useEditorStore.getState().activeTabId) callbacks.onOutlineOpen();
  },
  // ⌘N creates the note in the active document's directory (file-dir-aware).
  // If the active file isn't inside an open project (or nothing is open), show
  // the "open a project" hint instead of silently creating elsewhere.
  "new-note": ({ callbacks }) => {
    const { activeTabId, openDocuments } = useEditorStore.getState();
    const active = activeTabId
      ? openDocuments.find((t) => t.id === activeTabId)
      : null;
    const parent = resolveCreateParent(
      active?.filePath ?? null,
      useWorkspaceStore.getState().projects,
    );
    if (!parent) {
      toast.info("Open a project to create a note");
      return;
    }
    callbacks.onNewNote(parent);
  },
  "new-project": ({ callbacks }) => callbacks.onNewProject(),
  "open-folder": ({ callbacks }) => callbacks.onOpenFolder(),
  "copy-document-path": () => copyActiveDocumentPath(),
  "reveal-in-finder": () => revealActiveDocument(),
  // Direction comes from the command identity, not the live event modifier —
  // each chord owns its direction (⌃Tab → next, ⌃⇧Tab → previous).
  "cycle-recent-next": () => emitCycleRecent("next"),
  "cycle-recent-previous": () => emitCycleRecent("previous"),

  // ── UI chrome ────────────────────────────────────────────────────────
  "toggle-sidebar": () => {
    const settings = useSettingsStore.getState();
    settings.setSidebarPinned(!settings.sidebarPinned);
  },
  "toggle-activity-agent": () => emitAgentOrbEvent({ type: "toggle" }),
  "toggle-theme": () => {
    const settings = useSettingsStore.getState();
    settings.setTheme(settings.theme === "dark" ? "light" : "dark");
  },
  "open-settings": ({ callbacks }) => callbacks.onSettingsOpen(),
  "keyboard-shortcuts": ({ callbacks }) => callbacks.onShortcutsOpen(),
  "toggle-recording": ({ callbacks }) => callbacks.onToggleRecording?.(),

  // ── Editor view-zoom (transient, layout-stable via produced char) ────
  "zoom-in": () => fireZoom("in"),
  "zoom-out": () => fireZoom("out"),
  "zoom-reset": () => fireZoom("reset"),

  // ── Focus mode (state owned by useFocusMode via the controller bridge) ─
  "toggle-focus-mode": () => getFocusModeController()?.toggle(),
  "exit-focus-mode": () => getFocusModeController()?.exit(),

  // ── Developer ─────────────────────────────────────────────────────────
  // Available in dev + alpha builds only; hidden from stable end users.
  "open-devtools": () => {
    if (!isAlphaBuild()) return;
    import("@tauri-apps/api/core").then(({ invoke }) => {
      invoke("open_devtools").catch(console.error);
    });
  },
};

/**
 * Optional per-command guards. When a guard returns false the dispatcher does
 * NOT match the chord (no preventDefault, no action) — the key falls through to
 * other handlers. Used for the Esc fall-through: `exit-focus-mode` only claims
 * Esc when focus mode is active and nothing higher-priority wants the key.
 */
export const shortcutGuards: Record<string, () => boolean> = {
  // Only claim ⌘. when focus mode is actually mounted — otherwise let the key
  // fall through instead of preventDefault-ing it into a no-op.
  "toggle-focus-mode": () => getFocusModeController() !== null,
  "exit-focus-mode": () => getFocusModeController()?.canExitViaEsc() ?? false,
};
