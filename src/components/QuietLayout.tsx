import { useEffect } from "react";
import { toast } from "sonner";
import { TitleBar } from "@/components/TitleBar";
import type { AgentTask } from "@/stores/activity-store";
import FloatingCommandBar from "@/components/cmd/FloatingCommandBar";
import { AgentOrb } from "@/components/activity/AgentOrb";
import { QuietSidebar } from "@/components/sidebar/quiet/QuietSidebar";
import { Editor } from "@/components/editor/Editor";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { useSettingsStore } from "@/stores/settings-store";
import { useQuietSidebarStore } from "@/stores/quiet-sidebar-store";
import { useEditorStore } from "@/stores/editor-store";
import { useWorkspaceStore, type WorkspaceProject } from "@/stores/workspace-store";
import { useFadeOnType } from "@/hooks/useFadeOnType";
import { useFocusMode } from "@/hooks/useFocusMode";
import { useWindowFocus } from "@/hooks/useWindowFocus";
import { FocusPill } from "@/components/editor/FocusPill";
import { useQuietChrome } from "@/lib/quiet-chrome";
import { cn } from "@/lib/utils";

/**
 * QuietLayout — the app's UI shell (PRD `2026-04-21-ui-refresh`,
 * formerly the "Quiet Composer" Phase 1 preview; Classic Layout was
 * removed in #325).
 *
 * Renders a two-column grid under a TitleBar:
 *
 *   - QuietSidebar (#30)          → left column (240px)
 *   - Editor (#101) → centre document area (1fr); the DocHead breadcrumb
 *     that originally shipped here was removed in #131 — dirty + saved-ago
 *     readouts moved to the TitleBar's quiet-mode right zone.
 *
 * There is no separate right column for chat (#102). The chat surface
 * in Quiet Composer IS the `<FloatingCommandBar />` mounted below the
 * grid — in floating mode it portal-mounts over the workspace, in
 * pinned mode it docks as a fixed-position right-edge panel and the
 * document area reserves matching padding-right via the
 * `--cmd-bar-pinned-width` CSS variable. The cmd bar IS the chat
 * surface — no separate chat panel.
 *
 * The centre column hosts the `<Editor />` mount tree backed by
 * `editor-store`. The editor component itself owns its inner chrome
 * (Toolbar, FindBar, BubbleMenu, StatusBar, ExportDialog,
 * CommentPopover, etc.) — QuietLayout just supplies the slot and
 * forwards the layout-level callbacks.
 */

export interface QuietLayoutProps {
  focusMode?: boolean;
  stripExpanded: boolean;
  // Editor area callbacks
  onNewNote: (parentPath?: string) => void;
  onNewProject: () => void;
  onOpenFolder: () => void;
  onOpenProject: (path: string) => void;
  onOpenFile: (path: string, name: string) => void;
  // Export
  exportOpen: boolean;
  onExportOpenChange: (open: boolean) => void;
  // Outline
  outlineOpen: boolean;
  onOutlineOpenChange: (open: boolean) => void;
  // Update
  updateAvailable: boolean;
  updateVersion: string | null;
  onUpdateClick: () => void;
  // Misc
  onShortcutsOpen: () => void;
  onOpenActions: () => void;
  onOpenSettings: () => void;
  onBrowseForProject: () => void;
  onOpenProjectSettings: (path: string) => void;
  onMakeProject: (path: string) => void;
  onExportFile: (filePath: string, fileName: string, format?: 'pdf' | 'docx' | 'pptx' | 'html') => void;
  // Activity
  onCancelTask: (taskId: string) => Promise<void>;
  onClickTask: (task: AgentTask) => void;
}

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

export function QuietLayout(props: QuietLayoutProps) {
  // Editor props — forwarded from App.tsx so the centre-column Editor
  // mount has the file-operation callbacks it needs (new note, new
  // project, open folder/project/file, export, etc.).
  const {
    onNewNote,
    onNewProject,
    onOpenFolder,
    onOpenProject,
    onOpenFile,
    exportOpen,
    onExportOpenChange,
    outlineOpen,
    onOutlineOpenChange,
    updateAvailable,
    updateVersion,
    onUpdateClick,
    onShortcutsOpen,
    onOpenActions,
    focusMode: focusModeProp,
    // #130 — agent task cancel/navigate callbacks flow from App.tsx →
    // QuietLayout → AgentOrb → AgentPanel so task rows inside the orb
    // popover are clickable.
    onCancelTask,
    onClickTask,
  } = props;

  // #50 — Fade pre-stamped chrome while the user is typing. No-op under
  // `prefers-reduced-motion`. Keyed off the DOM class `.typing` on the
  // `[data-quiet-layout-root]` node below, so state lives on the DOM and
  // typing never triggers a React re-render.
  useFadeOnType();

  // Audit #17 (2026-04-27 quiet-composer-migration) — macOS-style
  // unfocused-window de-emphasis. Toggles `data-window-inactive="true"`
  // on the `[data-quiet-layout-root]` node below; CSS in `globals.css`
  // re-points `--accent` to the desaturated inactive variant and dims
  // pre-stamped chrome targets.
  useWindowFocus();

  // #56 — Focus mode. Owns the `⌘.` toggle and the `Esc` fall-through
  // chain (open popover → command bar expanded → inline edit → focus
  // mode). Applies `.focus-mode` to the layout root; CSS in `globals.css`
  // handles the sidebar slide-out, chrome fade, document top-padding, and
  // orb dim. The FocusPill below renders the exit affordance.
  const focus = useFocusMode();

  // #51 — Apply quiet-chrome preset data attributes onto the layout root.
  // CSS in globals.css keys off the attributes to decide which chrome
  // targets fade under the `.app.typing` pulse (toolbar, status, doc-head,
  // sidebar, orb). Pure attribute writes — no React re-render on typing.
  useQuietChrome();

  // The editor reads `focusMode` to gate its own chrome (Toolbar, StatusBar).
  // QuietLayout owns the live focus-mode flag via `useFocusMode()` above.
  // OR with the prop too in case a future code path drives it from App.
  const editorFocusMode = focus.active || !!focusModeProp;

  // When the command bar is pinned (#28), the document column needs to
  // reserve the equivalent right padding so editor content doesn't slide
  // under the side panel. The width comes from the same CSS variable the
  // bar's drag handle drives — sharing the variable means a single source
  // of truth and zero React re-renders during drag.
  const cmdBarPinned = useSettingsStore((s) => s.cmdBarPinned);

  // #132 — translucent chrome + editor flow-under. When the setting is
  // on, the TitleBar overlays the document area (absolute positioned)
  // instead of pushing it down, and the doc area gets top padding so
  // initial content clears the chrome. Both surfaces become
  // semi-transparent with a backdrop-blur via classes that key off the
  // root `data-quiet-chrome-transparent` attribute.
  const quietChromeTransparent = useSettingsStore(
    (s) => s.quietChromeTransparent,
  );

  // `⌘⇧L` — sidebar visibility (#123). The chord flips
  // `settings-store.sidebarPinned` via `useKeyboardShortcuts`; QuietLayout
  // observes the flag and either renders the sidebar + reserves the 252px
  // grid track, or omits the sidebar entirely and collapses the grid to a
  // single `1fr` column. Default is `true` (sidebar visible out of the box).
  const sidebarPinned = useSettingsStore((s) => s.sidebarPinned);

  const documentAreaStyle: React.CSSProperties = cmdBarPinned
    ? { paddingRight: "var(--cmd-bar-pinned-width, 400px)" }
    : {};

  // Live-test 2026-04-25 — sidebar full-height restructure.
  //
  // Layout root is now `flex` (row) instead of `flex-col`. The sidebar
  // is a SIBLING of the title-bar + doc-area column (no longer a child
  // of the doc-area grid), which lets it extend from the app's top
  // edge to its bottom edge — the divider runs unbroken behind the
  // traffic lights, matching Linear / Bear / Craft.
  //
  // `--quiet-sidebar-width` is published on the document root
  // (`<html>`) — NOT on the layout-root div — because the
  // `FloatingCommandBar` portals to `document.body`, which sits
  // OUTSIDE the layout-root. CSS variables cascade DOWN the tree,
  // not up; setting the var on `<html>` lets descendants of body
  // (including the portaled bar) read it for `left: calc(50% +
  // var(--quiet-sidebar-width) / 2)`.
  useEffect(() => {
    document.documentElement.style.setProperty(
      "--quiet-sidebar-width",
      sidebarPinned ? "252px" : "0px",
    );
    return () => {
      document.documentElement.style.removeProperty("--quiet-sidebar-width");
    };
  }, [sidebarPinned]);

  // `⌘⇧E` capture-phase listener was REMOVED in sidebar #20 along with
  // TreeOverlay. The chord now bubbles to the `useKeyboardShortcuts`
  // handler, where it opens the Export dialog (multi-format — PDF /
  // DOCX / PPTX / HTML). Sidebar #22 covers the doc updates for that
  // rebinding.

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
        ? editorState.openDocuments.find((t) => t.id === editorState.activeTabId)
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
  // `quiet-sidebar-store.pendingCreateProject`. Capture-phase +
  // stopImmediatePropagation so the chord can't fall through to any
  // other listener.
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
      data-quiet-chrome-transparent={quietChromeTransparent ? "true" : "false"}
      className="app relative flex h-screen w-full bg-background overflow-hidden"
    >
      {/*
        Sidebar (full-height, app top edge → bottom). Lives at the
        layout-root level — NOT inside the doc-area — so its right
        border runs unbroken from y=0 to y=full-height, behind the
        traffic lights. Internal `pt-10` keeps content clear of the
        macOS traffic-light safe zone.
       */}
      {sidebarPinned ? <QuietSidebar /> : null}

      {/* Right column: title bar above doc-area. The title bar centres
          its label inside this column, which means the title shares a
          vertical centerline with the editor (the toolbar pill is
          centred inside its own editor parent). Sidebar pin/unpin no
          longer shifts the document chrome's centerline. */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        {/*
          TitleBar — renders the document title + dirty dot + close
          button. The FloatingCommandBar and AgentOrb own the chat /
          agent-panel affordances; the title bar carries no toggle
          buttons in this shell.

          #132 — when `quietChromeTransparent` is on the title bar
          overlays the doc area instead of pushing it down. The
          `absolute top-0 inset-x-0 z-30` keeps it spanning only this
          right column (sidebar's column is unaffected — the strong
          right border continues uninterrupted underneath).
        */}
        {/* Live-test 2026-04-25 — title bar ALWAYS absolute-overlays
            the right column (regardless of `quietChromeTransparent`)
            so the sidebar's right border can run unbroken from
            y=0 to y=full-height. The title bar starts at the
            sidebar's right edge (`left: var(--quiet-sidebar-width)`)
            so the title stays centred inside the right column, NOT
            the full window — same vertical centerline as the
            editor's pill toolbar. In non-transparent mode the bar
            has a solid bg; in transparent mode it gets the frosted-
            glass treatment via the
            `[data-quiet-chrome-transparent="true"]` selector in
            globals.css. The right column compensates with `pt-9`
            so editor content starts below the bar. */}
        <TitleBar
          className="absolute right-0 top-0 z-30 left-[var(--quiet-sidebar-width,0px)]"
        />

        <div
          data-quiet-layout-document-area
          data-sidebar-pinned={sidebarPinned ? "true" : "false"}
          className={cn(
            // Live-test 2026-04-25 — title bar is now always absolute-
            // overlay (so the sidebar can extend to y=0). Doc-area
            // gets `pt-11` (36 px title bar + 8 px breathing room)
            // ONLY when transparent chrome is OFF — when on, the
            // editor's scroll content scrolls BEHIND the frosted
            // title bar and supplies its own pt via the
            // `[data-quiet-chrome-transparent="true"]` selectors in
            // globals.css.
            "flex-1 flex min-h-0 px-2 pb-2",
            !quietChromeTransparent && "pt-11",
            // #142 — when chrome is transparent the title bar overlays the
            // doc area instead of pushing it down. Content can scroll
            // BEHIND the frosted title bar; the editor's scroll content
            // (and the floating pill toolbar) own their own top
            // clearance via the
            // `[data-quiet-chrome-transparent="true"]` CSS rules in
            // globals.css.
          )}
          style={documentAreaStyle}
        >
          <div className="flex-1 flex flex-col min-h-0 min-w-0">
            {/*
              Editor mount (#101). `editor-store` drives document
              switches, dirty tracking, and the per-tab EditorState
              cache. The editor itself owns its inner chrome (Toolbar,
              FindBar, BubbleMenu, StatusBar, ExportDialog,
              CommentPopover, TranscriptionOverlay, DocumentOutline).
              `focusMode` is
              driven by QuietLayout's local `useFocusMode` hook (see
              `editorFocusMode` above) so the editor hides its toolbar /
              status while focus mode is active. `data-doc-area` is the
              focus-mode CSS hook (see globals.css
              `.app.focus-mode [data-doc-area]`).
            */}
            <div data-doc-area className="flex-1 min-h-0">
              <ErrorBoundary name="Editor">
                <Editor
                  onNewNote={onNewNote}
                  onNewProject={onNewProject}
                  onOpenFolder={onOpenFolder}
                  onOpenProject={onOpenProject}
                  onOpenFile={onOpenFile}
                  exportOpen={exportOpen}
                  onExportOpenChange={onExportOpenChange}
                  focusMode={editorFocusMode}
                  outlineOpen={outlineOpen}
                  onOutlineOpenChange={onOutlineOpenChange}
                  updateAvailable={updateAvailable}
                  updateVersion={updateVersion}
                  onUpdateClick={onUpdateClick}
                  onShortcutsOpen={onShortcutsOpen}
                  onOpenActions={onOpenActions}
                />
              </ErrorBoundary>
            </div>
          </div>
        </div>
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
      <AgentOrb onCancelTask={onCancelTask} onClickTask={onClickTask} />

      {/*
        TreeOverlay was REMOVED in sidebar-simplification task #20. The
        in-sidebar inline-expand pattern (`→` on a focused project /
        folder) is now the canonical "see what's in this thing" path
        — `FoldersSection` exists for ad-hoc `⌘O` folders, FolderPeek
        hover-clicks dispatch `notesage:sidebar-expand-path` to the
        same expand handler, and `⌘⇧E` is reclaimed by the Export
        dialog (sidebar #22).
       */}

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
