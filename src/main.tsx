import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { MobileApp } from "./MobileApp";
import { isIos } from "@/lib/platform";
import { reportCspViolations } from "@/lib/csp-violation-reporter";
// Sonner ships its base stylesheet as a file AND injects the same CSS inline
// at runtime. Only the injection was ever reaching the app — nothing imported
// the file — and the shipped CSP refuses it, because Tauri appends a nonce to
// `style-src` which makes the `'unsafe-inline'` in tauri.conf.json inert. So
// production has been rendering toasts without any of sonner's 24 base rules,
// including the toaster positioning, while development looked fine (`tauri
// dev` serves over Vite with no CSP). Importing the file routes them through
// the bundler into the hashed stylesheet, which `style-src 'self'` allows.
//
// BEFORE globals.css on purpose: globals.css carries `[data-sonner-toast]`
// overrides written against these rules, and both are un-layered, so the
// later one wins ties.
import "sonner/dist/styles.css";
import "@/styles/globals.css";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useEditorStore } from "@/stores/editor-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useLocalAIStore } from "@/stores/local-ai-store";
import { useConnectionsStore } from "@/stores/connections-store";
import {
  planLibraryMigration,
  runLibraryMigration,
  unaccountedInOldRoot,
} from "@/lib/library-migration";
import {
  buildMigrationListing,
  collectSidecarFilePaths,
  markerWriteDeps,
  migrationDeps,
  undoStoreDeps,
  clearMigrationInMarker,
  recordMigrationInMarker,
} from "@/lib/library-migration-run";
import { applyPathRewrites, planPathRewrites } from "@/lib/library-migration-paths";
import { materialiseDeps, materialiseLibrary } from "@/lib/library-materialise";
import {
  discardUndoRecord,
  latestUndoRecord,
  saveUndoRecord,
  undoLibraryMigration,
  undoRecordFor,
} from "@/lib/library-migration-undo";
import { lockLibraryRoots, unlockLibraryRoots } from "@/lib/library-lock";
import { useInboxStore } from "@/stores/inbox-store";

// Point Excalidraw at the locally-bundled Latin font families (copied to
// /excalidraw-assets/ by the `excalidraw-local-fonts` Vite plugin) so it loads
// them from the app origin (`font-src 'self'`) instead of the esm.sh CDN, which
// our CSP blocks. Set before any dynamic `import("@excalidraw/excalidraw")`
// runs. The 12 MB Xiaolai CJK font is intentionally NOT bundled — it falls back
// to the CDN and stays CSP-blocked (harmless; Notesage doesn't need CJK).
declare global {
  interface Window {
    EXCALIDRAW_ASSET_PATH?: string;
  }
}
window.EXCALIDRAW_ASSET_PATH = "/excalidraw-assets/";

// Suppress React 19 flushSync warning from Tiptap's ReactNodeViewRenderer.
// Tiptap creates React-based NodeViews (chart, drawing, link preview) via flushSync
// during ProseMirror state updates, which may happen inside React commit phases.
// This is valid behavior — React 19 warns about it but it works correctly.
// The warning is dev-mode only and does not appear in production builds.
// Upstream issue: https://github.com/ueberdosis/tiptap/issues/3764
if (import.meta.env.DEV) {
  const origConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    if (typeof args[0] === "string" && args[0].includes("flushSync was called from inside a lifecycle method")) {
      return;
    }
    origConsoleError.apply(console, args);
  };
}

// Expose Zustand stores on window in dev mode for E2E testing.
// Runs at module load time, guaranteed before any WebDriver session connects.
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__E2E_WORKSPACE_STORE__ = useWorkspaceStore;
  (window as unknown as Record<string, unknown>).__E2E_INBOX_STORE__ = useInboxStore;
  (window as unknown as Record<string, unknown>).__E2E_EDITOR_STORE__ = useEditorStore;
  (window as unknown as Record<string, unknown>).__E2E_SETTINGS_STORE__ = useSettingsStore;
  (window as unknown as Record<string, unknown>).__E2E_LOCAL_AI_STORE__ = useLocalAIStore;
  (window as unknown as Record<string, unknown>).__E2E_CONNECTIONS_STORE__ = useConnectionsStore;
  // The library migration, so a real-E2E spec can run it end to end against a
  // THROWAWAY library. Everything else that covers this feature stops at a
  // seam: the rehearsal suite drives the planner and runner over real files
  // but through node `fs`, and `sync.rs`'s tests cover the Rust primitive on
  // its own. Nothing exercised the join — the actual Tauri IPC — and a
  // migration that moves every file somebody owns should not first meet that
  // boundary on a real library.
  (window as unknown as Record<string, unknown>).__E2E_LIBRARY_MIGRATION__ = {
    buildMigrationListing,
    planLibraryMigration,
    runLibraryMigration,
    migrationDeps,
    recordMigrationInMarker,
    markerWriteDeps,
    collectSidecarFilePaths,
    unaccountedInOldRoot,
    planPathRewrites,
    applyPathRewrites,
    lockLibraryRoots,
    unlockLibraryRoots,
    // The undo too: reversing a migration is itself a migration, and it meets
    // the same IPC boundary. A record round-tripped through the real store is
    // the only way to see that the persisted shape survives the trip.
    undoLibraryMigration,
    undoRecordFor,
    saveUndoRecord,
    latestUndoRecord,
    discardUndoRecord,
    undoStoreDeps,
    clearMigrationInMarker,
    // The pre-flight, which has its own IPC boundary (`list_evicted_placeholders`)
    // and is the one guard between the migration and an unrecoverable stub move.
    materialiseLibrary,
    materialiseDeps,
  };
}

// Registered before anything renders: the stylesheet violations this exists to
// identify fire during the first paint, and a listener attached afterwards
// would miss every one of them.
reportCspViolations();

// Choose the shell at the root so desktop lifecycle hooks (AI, ACP, watcher,
// git, editor) are never called on iOS — the mobile shell is read-only + share
// capture. See src/lib/platform.ts.
const Root = isIos() ? MobileApp : App;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
