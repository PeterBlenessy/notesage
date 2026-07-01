import { useEffect } from "react";
import { TitleBar } from "@/components/TitleBar";
import type { AgentTask } from "@/stores/activity-store";
import FloatingCommandBar from "@/components/cmd/FloatingCommandBar";
import { AgentOrb } from "@/components/activity/AgentOrb";
import { DomainApprovalStack } from "@/components/chat/DomainApprovalStack";
import { QuietSidebar } from "@/components/sidebar/quiet/QuietSidebar";
import { Editor } from "@/components/editor/Editor";
import { RelationsPanel } from "@/components/editor/RelationsPanel";
import { EditorLinkHoverPreview } from "@/components/editor/EditorLinkHoverPreview";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { useSettingsStore } from "@/stores/settings-store";
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

  // Show/hide the TitleBar (document name + dirty dot + close ×). Default off —
  // the filename lives in the sidebar + StatusBar and dragging/window controls
  // are handled by the sidebar's full-height drag region, so the bar is optional
  // chrome. When hidden, the document area reclaims the vertical space and a thin
  // invisible drag strip preserves window-dragging (and clears the macOS
  // traffic-light safe zone when the sidebar is also hidden).
  const showTitleBar = useSettingsStore((s) => s.showTitleBar);

  // `⌘⇧L` — sidebar visibility (#123). The chord flips
  // `settings-store.sidebarPinned` via `useKeyboardShortcuts`; QuietLayout
  // observes the flag and either renders the sidebar + reserves the 252px
  // grid track, or omits the sidebar entirely and collapses the grid to a
  // single `1fr` column. Default is `true` (sidebar visible out of the box).
  const sidebarPinned = useSettingsStore((s) => s.sidebarPinned);
  // Persisted, user-resizable sidebar width (drag handle in QuietSidebar). Drives
  // `--quiet-sidebar-width` below; during a drag the handle writes the var
  // directly (no React re-render) and persists on pointer-up.
  const sidebarWidth = useSettingsStore((s) => s.sidebarWidth);

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
      sidebarPinned ? `${sidebarWidth}px` : "0px",
    );
    return () => {
      document.documentElement.style.removeProperty("--quiet-sidebar-width");
    };
  }, [sidebarPinned, sidebarWidth]);

  // `⌘⇧E` capture-phase listener was REMOVED in sidebar #20 along with
  // TreeOverlay. The chord now bubbles to the `useKeyboardShortcuts`
  // handler, where it opens the Export dialog (multi-format — PDF /
  // DOCX / PPTX / HTML). Sidebar #22 covers the doc updates for that
  // rebinding.

  // `⌘N` (new note) and `⌘⇧N` (new project) are owned by the App-root
  // dispatcher (`useGlobalShortcuts`) at capture phase — its `new-note` /
  // `new-project` actions call `App.tsx`'s `handleNewNote` / `handleNewProject`,
  // which drive the same `quiet-sidebar-store` inline-create rows this layout
  // previously triggered via two duplicate capture listeners. Centralizing them
  // also fixes the old focus-dependent divergence (the chords no longer fire
  // while typing in the editor — `firesWhileTyping: false`).

  return (
    <div
      data-quiet-layout-placeholder
      data-quiet-layout-root
      data-cmd-bar-pinned={cmdBarPinned ? "true" : "false"}
      data-quiet-chrome-transparent={quietChromeTransparent ? "true" : "false"}
      data-titlebar-hidden={showTitleBar ? "false" : "true"}
      className="app relative flex h-screen w-full bg-background overflow-hidden"
    >
      {/*
        Sidebar (full-height, app top edge → bottom). Lives at the
        layout-root level — NOT inside the doc-area — so its right
        border runs unbroken from y=0 to y=full-height, behind the
        traffic lights. Internal `pt-10` keeps content clear of the
        macOS traffic-light safe zone.
       */}
      {sidebarPinned ? <QuietSidebar onOpenSettings={props.onOpenSettings} /> : null}

      {/* Right column: title bar above doc-area. The title bar centres
          its label inside this column, which means the title shares a
          vertical centerline with the editor (the toolbar pill is
          centred inside its own editor parent). Sidebar pin/unpin no
          longer shifts the document chrome's centerline. */}
      <div className="relative flex-1 flex flex-col min-w-0 min-h-0">
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
        {showTitleBar ? (
          <TitleBar
            className="absolute right-0 top-0 z-30 left-[var(--quiet-sidebar-width,0px)]"
          />
        ) : !sidebarPinned ? (
          // TitleBar hidden AND sidebar hidden — the document column spans the
          // full width, so its top-left sits under the macOS traffic lights. A
          // thin invisible drag region covers that safe zone so the window stays
          // movable and content (which gets matching `pt-10`) clears the lights.
          // When the sidebar IS shown it owns the drag region + covers the
          // traffic-light corner, so no strip here and the document goes flush
          // to the top.
          <div
            aria-hidden
            data-tauri-drag-region
            className="absolute right-0 top-0 z-30 left-0 h-10"
          />
        ) : null}

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
            //
            // TitleBar hidden (showTitleBar === false) — no bar to clear, and
            // the document surface goes FLUSH to the top in BOTH sidebar states
            // (no opaque inset band). When the sidebar is shown the traffic
            // lights sit over it; when hidden, the editor surface flows under a
            // transparent top zone and the editor's own content gets pushed down
            // to clear the traffic-light safe zone via the
            // `[data-titlebar-hidden][data-sidebar-pinned="false"]` rules in
            // globals.css. The transparent full-width drag strip above hosts the
            // lights + window dragging.
            "flex-1 flex min-h-0 px-2 pb-2",
            showTitleBar && !quietChromeTransparent && "pt-11",
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
                  onShortcutsOpen={onShortcutsOpen}
                  onOpenActions={onOpenActions}
                />
              </ErrorBoundary>
            </div>
          </div>
        </div>

        {/*
          RelationsPanel (OKF wiki-navigation, ADR 0004). Docked to the RIGHT
          EDGE OF THE DOCUMENT COLUMN (this `relative` right-column div), NOT the
          window edge — so it tracks the column as the sidebar resizes and
          COEXISTS with the pinned command bar by offsetting its handle inward by
          `--cmd-bar-pinned-width` (it stays available in pinned mode; only the
          AgentOrb, physically covered at bottom-right, hides). Self-hides when
          the open document has no relations. Wrapped in its own ErrorBoundary so
          a render error in the link graph can't unmount the editor.
         */}
        <ErrorBoundary name="Relations panel">
          {/* Focus mode hides the panel (chrome). Passing the live flag makes
              the component return null while active — which also unmounts any
              open PopoverContent (portaled to body, beyond the CSS reach of
              `.app.focus-mode`). */}
          <RelationsPanel focusModeActive={focus.active} />
        </ErrorBoundary>

        {/*
          EditorLinkHoverPreview (OKF wiki-navigation, ADR 0006/0007). Hovering
          an internal link inside `.ProseMirror` shows a Peek card (target title
          + type badge + description/snippet; unresolved → "click to create").
          Self-scopes via DOM event delegation, so the Editor needs no changes.
         */}
        <ErrorBoundary name="Link hover preview">
          <EditorLinkHoverPreview />
        </ErrorBoundary>
      </div>

      {/*
        Composer (PRD `2026-04-21-ui-refresh`, tasks #9 + #28). In floating
        mode it portal-mounts to document.body and overlays the workspace at
        the bottom-centre. In pinned mode it renders inline as a fixed-position
        right-edge side panel and the document area above reserves matching
        padding-right via the CSS variable.
       */}
      {/*
        ErrorBoundary: the command bar is the app's primary AI surface, fed by
        untrusted streams (ACP responses, chat-store state, segment views). An
        unhandled render error here must NOT unmount the whole app and lose
        unsaved editor content — it degrades to the boundary fallback instead
        (audit a11y H5).
       */}
      <ErrorBoundary name="Command bar">
        <FloatingCommandBar />
      </ErrorBoundary>

      {/*
        AgentOrb (PRD `2026-04-21-ui-refresh`, task #29). Fixed-position 46 px
        circle at the bottom-right of the workspace — pulses while
        `activity-store` reports running tasks > 0, hidden when the
        FloatingCommandBar is in pinned mode (the right side panel covers
        the same screen real estate). Wrapped in its own ErrorBoundary so a
        crash while rendering agent task rows can't take down the app (a11y H5).
       */}
      <ErrorBoundary name="Agent orb">
        <AgentOrb onCancelTask={onCancelTask} onClickTask={onClickTask} />
      </ErrorBoundary>

      {/*
        Network-domain approval cards. Always-mounted (driven by the
        `useNetworkDomainApprovals` App-root listener via `domain-request-store`)
        so an agent's unknown-domain request surfaces whether or not the command
        bar is expanded — a collapsed bar used to unmount the only listener,
        wedging sandboxed agents on their startup telemetry calls.
       */}
      <ErrorBoundary name="Domain approvals">
        <DomainApprovalStack />
      </ErrorBoundary>

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
