import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { QuickCapture } from "@/components/QuickCapture";
import "@/styles/globals.css";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useEditorStore } from "@/stores/editor-store";
import { useSettingsStore } from "@/stores/settings-store";

// Expose Zustand stores on window in dev mode for E2E testing.
// Runs at module load time, guaranteed before any WebDriver session connects.
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__E2E_WORKSPACE_STORE__ = useWorkspaceStore;
  (window as unknown as Record<string, unknown>).__E2E_EDITOR_STORE__ = useEditorStore;
  (window as unknown as Record<string, unknown>).__E2E_SETTINGS_STORE__ = useSettingsStore;
}

// Route to QuickCapture for the quick-capture window, otherwise full app
const params = new URLSearchParams(window.location.search);
const isQuickCapture = params.get("window") === "quick-capture";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {isQuickCapture ? <QuickCapture /> : <App />}
  </React.StrictMode>,
);
