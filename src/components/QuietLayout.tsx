import { useEffect } from "react";
import { toast } from "sonner";
import { TitleBar } from "@/components/TitleBar";
import type { LayoutProps } from "@/components/Layout";
import FloatingCommandBar from "@/components/cmd/FloatingCommandBar";
import { AgentOrb } from "@/components/activity/AgentOrb";
import { QuietSidebar } from "@/components/sidebar/quiet/QuietSidebar";
import { TreeOverlay } from "@/components/sidebar/quiet/TreeOverlay";
import { DocHead } from "@/components/editor/DocHead";
import { useSettingsStore } from "@/stores/settings-store";
import { useTreeOverlayStore } from "@/stores/tree-overlay-store";
import { useQuietSidebarStore } from "@/stores/quiet-sidebar-store";
import { useEditorStore } from "@/stores/editor-store";
import { useWorkspaceStore, type WorkspaceProject } from "@/stores/workspace-store";
import { useFadeOnType } from "@/hooks/useFadeOnType";
import { useFocusMode } from "@/hooks/useFocusMode";
import { FocusPill } from "@/components/editor/FocusPill";

/**
 * QuietLayout — placeholder shell for the Quiet Composer UI refresh
 * (PRD `2026-04-21-ui-refresh`, Phase 1).
 *
 * Mounted only when `settings.uiPreview === "quiet-composer"`. Renders a
 * three-zone scaffold under a TitleBar so subsequent tasks can drop in
 * the real components:
 *
 *   - #30 QuietSidebar  → left zone (240px)
 *   - #48 DocHead etc.  → centre document area
 *   - composer pinned mode → right reserved zone (240px)
 *
 * This file is intentionally a stub. It does NOT mount the editor, chat
 * panel, sidebar, or activity strip — those arrive in later tasks. The
 * placeholder is the point.
 */

export type QuietLayoutProps = LayoutProps;

/**
 * Resolve the parent directory for a new note triggered by `⌘N`. Returns
 * the active tab's parent dir if that path falls within any open project,
 * else the first project root if the user is not currently editing a
 * project file but at least one project is open, else `null` to signal
 * the no-match fallback.
 *
 * Exported for unit testing. Pure helper — no store or filesystem access.
 */
export function resolveCreateParent(
  activeFilePath: string | null,
  projects: WorkspaceProject[],
): string | null {
  if (projects.length === 0) return null;

  if (activeFilePath) {
    // Match the active tab against every open project. If the file lives
    // inside one, return its immediate parent directory so the new note
    // is created next to the current document.
    for (const p of projects) {
      if (activeFilePath === p.path) continue;
      if (activeFilePath.startsWith(p.path + "/")) {
        const lastSlash = activeFilePath.lastIndexOf("/");
        if (lastSlash > 0) return activeFilePath.slice(0, lastSlash);
      }
    }
  }

  // No active tab, or the active file is outside every open project.
  // Signal no-match so the caller can show the toast fallback.
  return null;
}

export function QuietLayout(_props: QuietLayoutProps) {
  // Props are accepted to mirror Layout's signature so the call site at
  // App.tsx → <Layout {...layoutProps} /> works without a per-branch
  // adapter. They will be wired into the real components in later tasks.
  void _props;

  // #50 — Fade pre-stamped chrome while the user is typing. No-op under
  // `prefers-reduced-motion`. Keyed off the DOM class `.typing` on the
  // `[data-quiet-layout-root]` node below, so state lives on the DOM and
  // typing never triggers a React re-render.
  useFadeOnType();

  // #56 — Focus mode. Owns the `⌘.` toggle and the `Esc` fall-through
  // chain (open popover → command bar expanded → inline edit → focus
  // mode). Applies `.focus-mode` to the layout root; CSS in `globals.css`
  // handles the sidebar slide-out, chrome fade, document top-padding, and
  // orb dim. The FocusPill below renders the exit affordance.
  const focus = useFocusMode();

  // Inert handlers for the toggle buttons — the real chat panel and
  // activity strip aren't part of the placeholder.
  const noop = () => {};

  // When the command bar is pinned (#28), the document column needs to
  // reserve the equivalent right padding so editor content doesn't slide
  // under the side panel. The width comes from the same CSS variable the
  // bar's drag handle drives — sharing the variable means a single source
  // of truth and zero React re-renders during drag.
  const cmdBarPinned = useSettingsStore((s) => s.cmdBarPinned);
  const documentAreaStyle: React.CSSProperties = cmdBarPinned
    ? { paddingRight: "var(--cmd-bar-pinned-width, 400px)" }
    : {};

  // `⌘⇧E` (or `Ctrl+Shift+E`) opens the TreeOverlay. Intentionally scoped to
  // QuietLayout so the legacy shell's `useKeyboardShortcuts` (which binds the
  // same chord to "Export as PDF") continues to own that chord outside the
  // quiet-composer preview. We preventDefault + stopImmediatePropagation so
  // the legacy handler, which registers a window-level listener at App
  // mount, never gets to open its dialog while this layout is active.
  const openOverlay = useTreeOverlayStore((s) => s.openOverlay);
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (!mod || !event.shiftKey || event.altKey) return;
      if (event.key.toLowerCase() !== "e") return;

      // Skip when the user is typing in an input/textarea/contenteditable
      // (outside the tree overlay itself) so we don't hijack editing
      // shortcuts in settings dialogs, inline renames, or the editor.
      const target = event.target;
      if (target instanceof HTMLElement) {
        const isTextInput =
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable;
        if (isTextInput && target.closest("[data-tree-overlay]") === null) {
          return;
        }
      }

      event.preventDefault();
      event.stopImmediatePropagation();
      openOverlay();
    };

    // `capture: true` runs our handler before the legacy App-level listener,
    // which registered with the default bubble-phase options. Combined with
    // stopImmediatePropagation, this keeps the export dialog from firing.
    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => {
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
    };
  }, [openOverlay]);

  // `⌘N` — inline create note (task #41). Routes to the QuietSidebar's
  // inline-edit row by setting `quiet-sidebar-store.pendingCreate` to the
  // active tab's parent directory (if it resides inside a project) or
  // triggering the fallback toast. `⌘⇧N` is intentionally NOT intercepted
  // — task #42 owns the project-create flow.
  const setPendingCreate = useQuietSidebarStore((s) => s.setPendingCreate);
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (!mod) return;
      // Don't fight `⌘⇧N` (task #42). `⌥⌘N` is also left alone.
      if (event.shiftKey || event.altKey) return;
      if (event.key.toLowerCase() !== "n") return;

      // Skip when the user is typing — same guard as `⌘⇧E` above.
      const target = event.target;
      if (target instanceof HTMLElement) {
        const isTextInput =
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable;
        if (isTextInput) {
          return;
        }
      }

      // Compute parent from active tab + open projects.
      const editorState = useEditorStore.getState();
      const activeTab = editorState.activeTabId
        ? editorState.tabs.find((t) => t.id === editorState.activeTabId)
        : null;
      const activeFilePath = activeTab?.filePath ?? null;
      const projects = useWorkspaceStore.getState().projects;
      const parentDir = resolveCreateParent(activeFilePath, projects);

      event.preventDefault();
      event.stopImmediatePropagation();

      if (!parentDir) {
        toast.info("Open a project to create a note");
        return;
      }

      setPendingCreate({ parentDir });
    };

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => {
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
    };
  }, [setPendingCreate]);

  // `⌘⇧N` — inline create project (task #42). Routes to the QuietSidebar's
  // top-of-Projects inline-edit row by flipping
  // `quiet-sidebar-store.pendingCreateProject`. The legacy shell binds the
  // same chord to "New Project" dialog via `useKeyboardShortcuts`; we use
  // capture phase + stopImmediatePropagation to claim the chord while the
  // quiet-composer preview is active.
  const setPendingCreateProject = useQuietSidebarStore(
    (s) => s.setPendingCreateProject,
  );
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (!mod) return;
      if (!event.shiftKey) return;
      if (event.altKey) return;
      if (event.key.toLowerCase() !== "n") return;

      // Skip when the user is typing — same guard as the other chords.
      const target = event.target;
      if (target instanceof HTMLElement) {
        const isTextInput =
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable;
        if (isTextInput) {
          return;
        }
      }

      event.preventDefault();
      event.stopImmediatePropagation();
      setPendingCreateProject(true);
    };

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => {
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
    };
  }, [setPendingCreateProject]);

  return (
    <div
      data-quiet-layout-placeholder
      data-quiet-layout-root
      data-cmd-bar-pinned={cmdBarPinned ? "true" : "false"}
      className="app relative flex flex-col h-screen w-full bg-background overflow-hidden"
    >
      <TitleBar onToggleChat={noop} onToggleActivityStrip={noop} />

      <div
        data-quiet-layout-document-area
        className="flex-1 grid min-h-0 gap-2 p-2"
        style={{
          gridTemplateColumns: "240px 1fr 240px",
          ...documentAreaStyle,
        }}
      >
        <QuietSidebar />
        <div className="flex flex-col min-h-0 min-w-0">
          <DocHead />
          <div
            data-doc-area-placeholder
            className="flex-1 min-h-0 flex items-center justify-center rounded-md border border-dashed border-border bg-muted/30"
          >
            <span className="text-muted-foreground text-sm">Document area (placeholder)</span>
          </div>
        </div>
        <ZonePlaceholder label="Reserved (placeholder)" />
      </div>

      {/*
        Composer (PRD `2026-04-21-ui-refresh`, tasks #9 + #28). In floating
        mode it portal-mounts to document.body and overlays the workspace at
        the bottom-centre. In pinned mode it renders inline as a fixed-position
        right-edge side panel and the document area above reserves matching
        padding-right via the CSS variable.
       */}
      <FloatingCommandBar />

      {/*
        AgentOrb (PRD `2026-04-21-ui-refresh`, task #29). Fixed-position 46 px
        circle at the bottom-right of the workspace — pulses while
        `activity-store` reports running tasks > 0, hidden when the
        FloatingCommandBar is in pinned mode (the right side panel covers
        the same screen real estate).
       */}
      <AgentOrb />

      {/*
        TreeOverlay (PRD `2026-04-21-ui-refresh`, task #38). Slide-in
        workspace-tree panel triggered by `⌘⇧E`. Rendered as a sibling of
        the layout grid so it can stack above the sidebar without being
        constrained by the grid's column track.
       */}
      <TreeOverlay />

      {/*
        FocusPill (PRD `2026-04-21-ui-refresh`, task #55). Small pill at
        the top-centre with an × affordance; only rendered while focus
        mode is active. Announces itself via aria-live; keyboard exit via
        `⌘.` is owned by `useFocusMode` above.
       */}
      <FocusPill active={focus.active} onExit={focus.exit} />
    </div>
  );
}

interface ZonePlaceholderProps {
  label: string;
}

function ZonePlaceholder({ label }: ZonePlaceholderProps) {
  return (
    <div className="flex items-center justify-center rounded-md border border-dashed border-border bg-muted/30 min-h-0">
      <span className="text-muted-foreground text-sm">{label}</span>
    </div>
  );
}
