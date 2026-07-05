import { useEffect } from "react";
import { useEditorStore } from "@/stores/editor-store";
import { tauriApi } from "@/lib/tauri";
import { isBinaryFileType, documentFormat, type FileType } from "@/lib/file-utils";
import { track } from "@/lib/telemetry";
import { log } from "@/lib/logger";
import { parseFrontmatter } from "@/lib/frontmatter";
import { setBinaryData } from "@/lib/binary-cache";

interface Tab {
  id: string;
  filePath: string;
  fileType: FileType;
  contentLoaded?: boolean;
}

interface TabContentLoaderOptions {
  activeTab: Tab | undefined;
  activeTabId: string | null | undefined;
  openDocuments: Tab[];
}

/**
 * On-demand + background content loading for editor tabs.
 *
 * 1. When a placeholder tab (`contentLoaded === false`) becomes active, load
 *    its content from disk (markdown → frontmatter split, binary → byte cache,
 *    image → empty content).
 * 2. Once the active tab is loaded, preload the remaining placeholder tabs so
 *    they open instantly when clicked.
 *
 * Extracted from Editor.tsx (deep-review refactor) — pure side-effect controller,
 * returns nothing.
 */
export function useEditorTabContentLoader({
  activeTab,
  activeTabId,
  openDocuments,
}: TabContentLoaderOptions): void {
  // On-demand content loading: when a placeholder tab becomes active, load its content from disk.
  useEffect(() => {
    if (!activeTab || activeTab.contentLoaded !== false) return;
    const { id, filePath, fileType } = activeTab;
    const t0 = performance.now();
    const fileName = filePath.split("/").pop() ?? filePath;

    track("document_opened", { format: documentFormat(fileName, fileType) });

    (async () => {
      try {
        if (fileType === "image") {
          useEditorStore.getState().loadTabContent(id, "");
          log.debug("perf:doc-load", "Doc content loaded from disk", { file: fileName, type: fileType, sizeKB: 0, ms: +(performance.now() - t0).toFixed(1) });
          return;
        }
        if (isBinaryFileType(fileType)) {
          const bytes = await tauriApi.readBinaryFile(filePath);
          const sizeKB = +(bytes.length / 1024).toFixed(1);
          setBinaryData(filePath, new Uint8Array(bytes));
          useEditorStore.getState().loadTabContent(id, "");
          log.debug("perf:doc-load", "Doc content loaded from disk", { file: fileName, type: fileType, sizeKB, ms: +(performance.now() - t0).toFixed(1) });
          return;
        }
        const raw = await tauriApi.readFile(filePath);
        const sizeKB = +(new TextEncoder().encode(raw).length / 1024).toFixed(1);
        if (fileType === "markdown") {
          const { frontmatter, content } = parseFrontmatter(raw);
          useEditorStore.getState().loadTabContent(id, content, frontmatter);
        } else {
          useEditorStore.getState().loadTabContent(id, raw);
        }
        log.debug("perf:doc-load", "Doc content loaded from disk", { file: fileName, type: fileType, sizeKB, ms: +(performance.now() - t0).toFixed(1) });
      } catch (err) {
        console.warn("Failed to load tab content:", filePath, err);
        useEditorStore.getState().setTabLoadError(id, String(err));
      }
    })();
  }, [activeTab?.id, activeTab?.contentLoaded]);

  // Background preloading: once the active tab is loaded, preload remaining placeholder tabs
  // so they open instantly when clicked.
  useEffect(() => {
    if (!activeTab || activeTab.contentLoaded === false) return;
    const unloaded = openDocuments.filter((t) => t.contentLoaded === false && t.id !== activeTabId);
    if (unloaded.length === 0) return;

    log.debug("perf:tab-preload", "Starting background preload", { count: unloaded.length });
    const t0 = performance.now();
    let cancelled = false;
    (async () => {
      for (const tab of unloaded) {
        if (cancelled) break;
        const tabT0 = performance.now();
        const fileName = tab.filePath.split("/").pop() ?? tab.filePath;
        try {
          if (tab.fileType === "image") {
            useEditorStore.getState().loadTabContent(tab.id, "");
            log.debug("perf:tab-preload", "Tab preloaded", { file: fileName, type: tab.fileType, sizeKB: 0, ms: +(performance.now() - tabT0).toFixed(1) });
            continue;
          }
          if (isBinaryFileType(tab.fileType)) {
            const bytes = await tauriApi.readBinaryFile(tab.filePath);
            if (cancelled) break;
            setBinaryData(tab.filePath, new Uint8Array(bytes));
            useEditorStore.getState().loadTabContent(tab.id, "");
            log.debug("perf:tab-preload", "Tab preloaded", { file: fileName, type: tab.fileType, sizeKB: +(bytes.length / 1024).toFixed(1), ms: +(performance.now() - tabT0).toFixed(1) });
            continue;
          }
          const raw = await tauriApi.readFile(tab.filePath);
          if (cancelled) break;
          const sizeKB = +(new TextEncoder().encode(raw).length / 1024).toFixed(1);
          if (tab.fileType === "markdown") {
            const { frontmatter, content } = parseFrontmatter(raw);
            useEditorStore.getState().loadTabContent(tab.id, content, frontmatter);
          } else {
            useEditorStore.getState().loadTabContent(tab.id, raw);
          }
          log.debug("perf:tab-preload", "Tab preloaded", { file: fileName, type: tab.fileType, sizeKB, ms: +(performance.now() - tabT0).toFixed(1) });
        } catch (err) {
          console.warn("Failed to preload tab:", tab.filePath, err);
          useEditorStore.getState().setTabLoadError(tab.id, String(err));
        }
      }
      if (!cancelled) {
        log.debug("perf:tab-preload", "All tabs preloaded", { count: unloaded.length, ms: +(performance.now() - t0).toFixed(1) });
      }
    })();
    return () => { cancelled = true; };
  }, [activeTab?.contentLoaded, activeTabId, openDocuments.length]);
}
