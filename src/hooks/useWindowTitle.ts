import { useEffect } from "react";
import { useEditorStore } from "@/stores/editor-store";

/**
 * Sync the browser `document.title` with the active editor tab so the
 * macOS window title bar surfaces the filename (task #105).
 *
 * Format:
 *   - `${fileName} — Notesage` when a document is active.
 *   - `Notesage` when no document is active.
 *
 * Mount once at the App level (same tier as the other `useStartup*`
 * hooks). WKWebView
 * reflects `document.title` as the OS-level window title on macOS, so
 * no Tauri IPC is needed for the basic case.
 */
const APP_NAME = "Notesage";

export function useWindowTitle(): void {
  const activeFileName = useEditorStore((s) => {
    const tab = s.openDocuments.find((t) => t.id === s.activeTabId);
    return tab?.fileName ?? null;
  });

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.title = activeFileName ? `${activeFileName} — ${APP_NAME}` : APP_NAME;
  }, [activeFileName]);
}
