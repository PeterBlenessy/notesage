import React from "react";
import ReactDOM from "react-dom/client";
import * as Sentry from "@sentry/browser";
import App from "./App";
import { MobileApp } from "./MobileApp";
import { isIos } from "@/lib/platform";
import "@/styles/globals.css";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useEditorStore } from "@/stores/editor-store";
import {
  useSettingsStore,
  selectEffectiveTelemetryCrash,
} from "@/stores/settings-store";
import { useLocalAIStore } from "@/stores/local-ai-store";
import { useConnectionsStore } from "@/stores/connections-store";

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
  (window as unknown as Record<string, unknown>).__E2E_EDITOR_STORE__ = useEditorStore;
  (window as unknown as Record<string, unknown>).__E2E_SETTINGS_STORE__ = useSettingsStore;
  (window as unknown as Record<string, unknown>).__E2E_LOCAL_AI_STORE__ = useLocalAIStore;
  (window as unknown as Record<string, unknown>).__E2E_CONNECTIONS_STORE__ = useConnectionsStore;
}

// Global crash capture for uncaught frontend errors and unhandled promise
// rejections. Routed to Sentry via the Rust-injected plugin client (we never
// call Sentry.init here — the plugin owns the client). Gated on the effective
// crash-reporting consent so nothing is captured when telemetry is off, and
// wrapped in try/catch so capture never interferes with the default handling.
// We do NOT preventDefault — the browser's own error logging still runs.
window.addEventListener("error", (event) => {
  try {
    if (selectEffectiveTelemetryCrash(useSettingsStore.getState())) {
      Sentry.captureException(event.error ?? event.message);
    }
  } catch {
    /* never let crash reporting throw from a global error handler */
  }
});

window.addEventListener("unhandledrejection", (event) => {
  try {
    if (selectEffectiveTelemetryCrash(useSettingsStore.getState())) {
      Sentry.captureException(event.reason);
    }
  } catch {
    /* never let crash reporting throw from a global rejection handler */
  }
});

// Choose the shell at the root so desktop lifecycle hooks (AI, ACP, watcher,
// git, editor) are never called on iOS — the mobile shell is read-only + share
// capture. See src/lib/platform.ts.
const Root = isIos() ? MobileApp : App;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
