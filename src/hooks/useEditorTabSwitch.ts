import { useEffect, useRef, useState, type MutableRefObject, type RefObject } from "react";
import type { Editor as TiptapEditor } from "@tiptap/core";
import type { EditorState } from "@tiptap/pm/state";
import { useEditorStore, type Tab } from "@/stores/editor-store";
import {
  AISuggestionPluginKey,
  setSuggestion,
} from "@/components/editor/extensions";
import { findNthTagInDoc, scrollPosToCenter, scrollToTextInEditor, PX_PER_CM } from "@/components/editor/editor-utils";
import { loadRawMarkdownIntoEditor, loadParsedJsonIntoEditor, type TableColumnMetadataMap, type ColumnMetadata } from "@/lib/markdown";
import { parseInWorker } from "@/lib/markdown-worker";
import type { ParseResult } from "@/workers/markdown-parse.types";
import { getDocumentDir } from "@/lib/image-utils";
import { getEditorStorage, type EditorStorageImage } from "@/lib/editor-storage";
import { tauriApi } from "@/lib/tauri";
import { useActiveProject } from "@/hooks/useActiveProject";
import { toast } from "sonner";
import { log } from "@/lib/logger";

/**
 * Reconstruct the side-channel Maps that the worker serialised as entries
 * arrays. Cheaper to send across `postMessage` as arrays than as Maps.
 */
function deserializeSideMaps(result: ParseResult): {
  annotations: Map<number, string>;
  nodeIds: Map<number, string>;
  tableMetadata: TableColumnMetadataMap;
} {
  const annotations = new Map<number, string>(result.annotationsEntries);
  const nodeIds = new Map<number, string>(result.nodeIdsEntries);
  const tableMetadata: TableColumnMetadataMap = new Map();
  for (const [tableIdx, colEntries] of result.tableMetadataEntries) {
    const colMap = new Map<number, ColumnMetadata>();
    for (const [colIdx, meta] of colEntries) {
      colMap.set(colIdx, meta);
    }
    tableMetadata.set(tableIdx, colMap);
  }
  return { annotations, nodeIds, tableMetadata };
}

/**
 * Schedule a callback strictly AFTER the browser has painted at least once.
 * Used by the instant-load preview path to defer `setContent` past the
 * preview's first paint frame so the user actually SEES the readable HTML
 * before the heavy 5-second parse blocks the main thread.
 *
 * Implementation: double `requestAnimationFrame`. The first rAF runs
 * pre-paint of frame N+1 (React's reconcile + commit have happened, but
 * the frame hasn't painted yet). The second rAF fires pre-paint of frame
 * N+2 — by which time frame N+1 has been painted, guaranteeing the
 * preview is on screen. `setTimeout(0)` would race the paint cycle in
 * WebKit; `requestIdleCallback` is unavailable in Safari/WKWebView and
 * had unreliable timing when present elsewhere. rAF×2 is the only
 * primitive whose ordering relative to paint is guaranteed.
 */
function deferPastPaint(callback: () => void): void {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      callback();
    });
  });
}

/**
 * Files under this byte threshold skip the comrak preview surface entirely
 * and go straight to the worker parse. At this size the worker is fast
 * enough (~50–250 ms) that mounting a preview adds visible flicker without
 * buying useful time, and eliminates any comrak↔editor CSS divergence for
 * small notes. PRD § "Layer 1b — Skip-preview rule" (Phase 3b).
 */
const SKIP_PREVIEW_THRESHOLD_BYTES = 50 * 1024;

interface AISuggestion {
  from: number;
  to: number;
  originalText: string;
  suggestedText: string;
}

interface UseEditorTabSwitchOptions {
  editor: TiptapEditor | null;
  activeTab: Tab | null;
  cachedEditorStatesRef: MutableRefObject<Map<string, EditorState>>;
  savedSuggestionsRef: MutableRefObject<Map<string, AISuggestion>>;
  scrollAreaRef: RefObject<HTMLDivElement | null>;
  isProgrammaticScroll: MutableRefObject<boolean>;
  lastLoadedTabId: MutableRefObject<string | null>;
  saveOutgoingTabScroll: () => void;
  restoreScrollRatio: (filePath: string, onComplete?: () => void) => void;
  externalChanges: Record<string, string>;
  updateTabContent: (id: string, content: string, isDirty: boolean) => void;
  clearExternalChange: (filePath: string) => void;
  setImageDialogOpen: (open: boolean) => void;
  isPaperMode: boolean;
  marginTop: number;
  marginBottom: number;
  pageHeight: number | undefined;
}

interface PageInfo {
  current: number;
  total: number;
}

export function useEditorTabSwitch({
  editor,
  activeTab,
  cachedEditorStatesRef,
  savedSuggestionsRef,
  scrollAreaRef,
  isProgrammaticScroll,
  lastLoadedTabId,
  saveOutgoingTabScroll,
  restoreScrollRatio,
  externalChanges,
  updateTabContent,
  clearExternalChange,
  setImageDialogOpen,
  isPaperMode,
  marginTop,
  marginBottom,
  pageHeight,
}: UseEditorTabSwitchOptions) {
  const setScrollToTag = useEditorStore((s) => s.setScrollToTag);
  const setScrollToText = useEditorStore((s) => s.setScrollToText);
  const { projectPath } = useActiveProject();

  // Tracks the tab id of an in-flight `render_markdown_preview` call so React
  // StrictMode's double-mount in dev (and any spurious effect re-fires) don't
  // cause duplicate backend renders that compete for the Tauri runtime. Cleared
  // when the call resolves (success or failure).
  const previewInFlightRef = useRef<string | null>(null);

  const [pageInfo, setPageInfo] = useState<PageInfo | null>(null);

  // Update editor content when switching tabs or when placeholder content finishes loading.
  useEffect(() => {
    if (!editor || !activeTab || activeTab.contentLoaded === false) return;
    if (activeTab.id === lastLoadedTabId.current) return;
      const switchT0 = performance.now();
      const fileName = activeTab.filePath.split("/").pop() ?? activeTab.filePath;
      const contentBytes = activeTab.content ? new TextEncoder().encode(activeTab.content).length : 0;
      const contentSizeKB = +(contentBytes / 1024).toFixed(1);

      // Save full editor state of the tab we're LEAVING (preserves undo/redo, selection, decorations)
      const prevTabId = lastLoadedTabId.current;
      if (prevTabId) {
        cachedEditorStatesRef.current.set(prevTabId, editor.state);
        // Also save AI suggestion separately (for explicit position validation on restore)
        const pluginState = AISuggestionPluginKey.getState(editor.state);
        if (pluginState?.suggestion) {
          savedSuggestionsRef.current.set(prevTabId, pluginState.suggestion);
        } else {
          savedSuggestionsRef.current.delete(prevTabId);
        }
      }

      // Save scroll position of the tab we're LEAVING
      saveOutgoingTabScroll();

      const cachedState = cachedEditorStatesRef.current.get(activeTab.id);
      const pendingExternal = externalChanges[activeTab.filePath];

      // Determine if this tab is eligible for the instant-load preview path
      // (PRD § "Layer 1"). The path applies to fresh-parse markdown loads
      // only — cache hits and external-change reloads are already fast and
      // benefit from staying synchronous.
      const isFreshMarkdownParse =
        !cachedState &&
        (pendingExternal === undefined || activeTab.isDirty) &&
        activeTab.fileType === "markdown" &&
        !!activeTab.content; // skip empty docs — preview adds latency without payoff

      // Hide scroll area to prevent flicker (content renders at top before scroll restores).
      const el = scrollAreaRef.current;
      if (el) {
        el.style.opacity = '0';
      }

      lastLoadedTabId.current = activeTab.id;
      const tabIdOnEntry = activeTab.id;

      // Set document directory BEFORE setContent so image nodes resolve paths correctly
      const imageStorage = getEditorStorage<EditorStorageImage>(editor, 'image');
      if (imageStorage) {
        imageStorage.documentDir = getDocumentDir(activeTab.filePath);
        imageStorage.openInsertDialog = () => setImageDialogOpen(true);
      }

      // ---------------------------------------------------------------
      // Post-load tail — runs AFTER content is loaded into the editor,
      // whether that happened synchronously or through the deferred
      // preview path. Closes over `restoredFromCache` so the AI
      // suggestion restore behaves the same in both flows.
      // ---------------------------------------------------------------
      const runPostLoad = (restoredFromCache: boolean) => {
        editor.commands.blur();

        if (!restoredFromCache) {
          const savedSuggestion = savedSuggestionsRef.current.get(tabIdOnEntry);
          if (savedSuggestion) {
            requestAnimationFrame(() => {
              if (savedSuggestion.from >= 0 && savedSuggestion.to <= editor.state.doc.content.size) {
                setSuggestion(editor, savedSuggestion.from, savedSuggestion.to, savedSuggestion.originalText, savedSuggestion.suggestedText);
              }
              savedSuggestionsRef.current.delete(tabIdOnEntry);
            });
          }
        }

        const restoreMethod = restoredFromCache ? "cache" : "parse";
        log.debug("perf:tab-switch", "Editor state restored", { file: fileName, sizeKB: contentSizeKB, restore: restoreMethod, setupMs: +(performance.now() - switchT0).toFixed(1) });

        if (activeTab.scrollToTag) {
          const { tag, occurrence } = activeTab.scrollToTag;
          setScrollToTag(activeTab.id, undefined);
          requestAnimationFrame(() => { requestAnimationFrame(() => {
            if (!editor.state?.doc) { if (scrollAreaRef.current) scrollAreaRef.current.style.opacity = '1'; return; }
            const pos = findNthTagInDoc(editor.state.doc, tag, occurrence);
            if (pos !== null && scrollAreaRef.current) {
              scrollPosToCenter(editor, pos, scrollAreaRef.current, isProgrammaticScroll);
            }
            if (scrollAreaRef.current) scrollAreaRef.current.style.opacity = '1';
            log.debug("perf:tab-switch", "Tab visible", { file: fileName, scroll: "tag", totalMs: +(performance.now() - switchT0).toFixed(1) });
          }); });
        } else if (activeTab.scrollToText) {
          const text = activeTab.scrollToText;
          setScrollToText(activeTab.id, undefined);
          requestAnimationFrame(() => { requestAnimationFrame(() => {
            scrollToTextInEditor(editor, text, scrollAreaRef.current, isProgrammaticScroll);
            if (scrollAreaRef.current) scrollAreaRef.current.style.opacity = '1';
            log.debug("perf:tab-switch", "Tab visible", { file: fileName, scroll: "text", totalMs: +(performance.now() - switchT0).toFixed(1) });
          }); });
        } else {
          restoreScrollRatio(activeTab.filePath, () => {
            if (scrollAreaRef.current) scrollAreaRef.current.style.opacity = '1';
            log.debug("perf:tab-switch", "Tab visible", { file: fileName, scroll: "position", totalMs: +(performance.now() - switchT0).toFixed(1) });
          });
        }
      };

      // ---------------------------------------------------------------
      // Path selection
      // ---------------------------------------------------------------

      if (pendingExternal !== undefined && !activeTab.isDirty) {
        // External change reload — sync, fast.
        cachedEditorStatesRef.current.delete(activeTab.id);
        loadRawMarkdownIntoEditor(editor, pendingExternal);
        updateTabContent(activeTab.id, pendingExternal, false);
        clearExternalChange(activeTab.filePath);
        toast("File updated from disk", { id: "external-change", description: activeTab.fileName });
        useEditorStore.getState().setPreviewState(activeTab.id, "hydrated");
        runPostLoad(false);
      } else if (cachedState) {
        // Cached editor state — sync, instant restore.
        editor.view.updateState(cachedState);
        cachedEditorStatesRef.current.delete(activeTab.id);
        useEditorStore.getState().setPreviewState(activeTab.id, "hydrated");
        runPostLoad(true);
      } else if (isFreshMarkdownParse && contentBytes < SKIP_PREVIEW_THRESHOLD_BYTES) {
        // SKIP-PREVIEW PATH (small file <50 KB) — go straight to the worker, no
        // comrak preview surface mounted. PRD § "Layer 1b — Skip-preview rule"
        // (Phase 3b). At this size the worker resolves in 50–250 ms; mounting
        // a preview adds visible flicker without buying any user-visible time
        // and reintroduces comrak↔editor CSS divergence on small notes.
        const tabContent = activeTab.content;
        log.debug("perf:tab-switch", "Skip-preview (small file)", {
          file: fileName,
          sizeKB: contentSizeKB,
        });
        useEditorStore.getState().setPreviewState(activeTab.id, "loading");
        const workerStart = performance.now();
        parseInWorker(tabContent, projectPath ?? undefined)
          .then((parseResult) => {
            const current = useEditorStore.getState().openDocuments.find((t) => t.id === tabIdOnEntry);
            if (!current || current.previewState === "hydrated") return;
            deferPastPaint(() => {
              const sideMaps = deserializeSideMaps(parseResult);
              loadParsedJsonIntoEditor(editor, parseResult.doc, sideMaps);
              useEditorStore.getState().setPreviewState(tabIdOnEntry, "hydrated");
              runPostLoad(false);
              log.debug("perf:tab-switch", "Editor hydrated (skip-preview)", {
                file: fileName,
                sizeKB: contentSizeKB,
                workerMs: +(performance.now() - workerStart).toFixed(1),
                workerPreprocess: parseResult.timings.preprocess,
                workerParse: parseResult.timings.parse,
                totalMs: +(performance.now() - switchT0).toFixed(1),
              });
            });
          })
          .catch((err) => {
            // Worker errored — fall back to legacy main-thread parse.
            console.warn("Worker parse failed (skip-preview); falling back:", activeTab.filePath, err);
            deferPastPaint(() => {
              loadRawMarkdownIntoEditor(editor, tabContent);
              useEditorStore.getState().setPreviewState(tabIdOnEntry, "hydrated");
              runPostLoad(false);
              log.debug("perf:tab-switch", "Editor hydrated (skip-preview, worker-fallback)", {
                file: fileName,
                sizeKB: contentSizeKB,
                reason: err instanceof Error ? err.message : String(err),
                totalMs: +(performance.now() - switchT0).toFixed(1),
              });
            });
          });
      } else if (isFreshMarkdownParse) {
        // PREVIEW PATH — fire renderMarkdownPreview, await, paint preview, defer
        // setContent past the next paint frame. Runs for click-from-sidebar AND
        // placeholder-restore flows (the on-demand-load effect populates content,
        // useEditorTabSwitch fires; this branch handles both since the path
        // selection is content-shaped, not flow-shaped). See PRD § "Layer 1".
        const tabContent = activeTab.content;
        const previewT0 = performance.now();
        const resolvedTheme: "light" | "dark" =
          document.documentElement.classList.contains("dark") ? "dark" : "light";

        // Skip if a backend call is already in flight for this tab. Guards
        // against StrictMode's double-mount and any spurious dependency-driven
        // re-fires. Cleared in `.finally`.
        if (previewInFlightRef.current === tabIdOnEntry) {
          log.debug("perf:tab-switch", "Preview already in flight — skip duplicate fire", { file: fileName });
          return;
        }
        previewInFlightRef.current = tabIdOnEntry;
        useEditorStore.getState().setPreviewState(activeTab.id, "loading");

        tauriApi
          .renderMarkdownPreview({
            path: activeTab.filePath,
            projectRoot: projectPath ?? undefined,
            theme: resolvedTheme,
          })
          .then((html) => {
            // Bail if the user has switched to a different tab, or an external-change
            // reload took over while preview was in flight.
            const current = useEditorStore.getState().openDocuments.find((t) => t.id === tabIdOnEntry);
            if (!current || current.previewState === "hydrated") return;
            log.debug("perf:tab-load", "Preview ready", { file: fileName, previewMs: +(performance.now() - previewT0).toFixed(1) });

            // Stash HTML — render branch swaps to <MarkdownPreview>.
            useEditorStore.getState().setPreview(tabIdOnEntry, html);
            // Reveal scroll area now that preview is on screen.
            if (scrollAreaRef.current) scrollAreaRef.current.style.opacity = '1';

            // Phase 2: kick off the worker parse in parallel with the preview
            // paint frame. The worker chews through markdown→HTML→ProseMirror
            // off the main thread; the main thread stays responsive (60fps
            // animations, scrolling, sidebar interaction all work) the whole
            // time. When the worker returns we feed the JSON straight to
            // `setContent(json, false)` — much cheaper than re-parsing the
            // markdown on the main thread.
            //
            // Worker errors fall through to the legacy main-thread parse via
            // `loadRawMarkdownIntoEditor` (Phase 2 #15 — fallback path).
            const workerStart = performance.now();
            parseInWorker(tabContent, projectPath ?? undefined)
              .then((parseResult) => {
                // Bail if the user has switched away or external-change reload
                // took over while the worker was running.
                const current = useEditorStore.getState().openDocuments.find((t) => t.id === tabIdOnEntry);
                if (!current || current.previewState === "hydrated") return;

                // Defer past paint — gives the preview at least one paint
                // frame on screen even if the worker returns very fast.
                deferPastPaint(() => {
                  const sideMaps = deserializeSideMaps(parseResult);
                  loadParsedJsonIntoEditor(editor, parseResult.doc, sideMaps);
                  useEditorStore.getState().setPreviewState(tabIdOnEntry, "hydrated");
                  runPostLoad(false);
                  log.debug("perf:tab-switch", "Editor hydrated after preview (worker)", {
                    file: fileName,
                    sizeKB: contentSizeKB,
                    workerMs: +(performance.now() - workerStart).toFixed(1),
                    workerPreprocess: parseResult.timings.preprocess,
                    workerParse: parseResult.timings.parse,
                    totalMs: +(performance.now() - switchT0).toFixed(1),
                  });
                });
              })
              .catch((err) => {
                // Worker errored or aborted — fall back to legacy main-thread parse.
                console.warn("Worker parse failed; falling back to main-thread parse:", activeTab.filePath, err);
                deferPastPaint(() => {
                  loadRawMarkdownIntoEditor(editor, tabContent);
                  useEditorStore.getState().setPreviewState(tabIdOnEntry, "hydrated");
                  runPostLoad(false);
                  log.debug("perf:tab-switch", "Editor hydrated after preview (worker-fallback)", {
                    file: fileName,
                    sizeKB: contentSizeKB,
                    reason: err instanceof Error ? err.message : String(err),
                    totalMs: +(performance.now() - switchT0).toFixed(1),
                  });
                });
              });
          })
          .catch((err) => {
            // Preview render failed — fall back to legacy synchronous path entirely.
            console.warn("Preview render failed:", activeTab.filePath, err);
            useEditorStore.getState().setPreviewState(tabIdOnEntry, "idle");
            loadRawMarkdownIntoEditor(editor, tabContent);
            runPostLoad(false);
          })
          .finally(() => {
            if (previewInFlightRef.current === tabIdOnEntry) {
              previewInFlightRef.current = null;
            }
          });
      } else {
        // Legacy synchronous path (non-markdown, empty docs, etc.)
        loadRawMarkdownIntoEditor(editor, activeTab.content);
        useEditorStore.getState().setPreviewState(activeTab.id, "hydrated");
        runPostLoad(false);
      }
  }, [activeTab?.id, editor, activeTab, saveOutgoingTabScroll, restoreScrollRatio, externalChanges, updateTabContent, clearExternalChange, setScrollToTag, setScrollToText, projectPath, isProgrammaticScroll, savedSuggestionsRef, scrollAreaRef, lastLoadedTabId, cachedEditorStatesRef, setImageDialogOpen]);

  // Scroll to tag when scrollToTag is set on the already-active tab (same-tab jump)
  useEffect(() => {
    if (!editor || !activeTab || !activeTab.scrollToTag) return;
    // Only handle same-tab jumps — tab-switch case is handled above
    if (activeTab.id !== lastLoadedTabId.current) return;
    const { tag, occurrence } = activeTab.scrollToTag;
    setScrollToTag(activeTab.id, undefined);
    requestAnimationFrame(() => {
      if (!editor.state?.doc) return;
      const pos = findNthTagInDoc(editor.state.doc, tag, occurrence);
      if (pos !== null && scrollAreaRef.current) {
        scrollPosToCenter(editor, pos, scrollAreaRef.current, isProgrammaticScroll);
      }
    });
  }, [editor, activeTab?.scrollToTag, activeTab?.id, setScrollToTag]);

  // Scroll to text when scrollToText is set on the already-active tab (same-tab jump)
  useEffect(() => {
    if (!editor || !activeTab || !activeTab.scrollToText) return;
    if (activeTab.id !== lastLoadedTabId.current) return;
    const text = activeTab.scrollToText;
    setScrollToText(activeTab.id, undefined);
    // Single rAF is enough — content is already rendered for same-tab jumps
    requestAnimationFrame(() => {
      scrollToTextInEditor(editor, text, scrollAreaRef.current, isProgrammaticScroll);
    });
  }, [editor, activeTab?.scrollToText, activeTab?.id, setScrollToText]);

  // When switching from Source → WYSIWYG, reload editor with current tab content
  const prevViewMode = useRef(activeTab?.viewMode);
  useEffect(() => {
    if (!editor || !activeTab) return;
    const wasSource = prevViewMode.current === "source";
    const isNowWysiwyg = activeTab.viewMode !== "source";
    prevViewMode.current = activeTab.viewMode;

    if (wasSource && isNowWysiwyg) {
      cachedEditorStatesRef.current.delete(activeTab.id);
      loadRawMarkdownIntoEditor(editor, activeTab.content);
      // Re-set image storage in case it was lost
      const imgStorage = getEditorStorage<EditorStorageImage>(editor, 'image');
      if (imgStorage) {
        imgStorage.documentDir = getDocumentDir(activeTab.filePath);
        imgStorage.openInsertDialog = () => setImageDialogOpen(true);
      }
    }
  }, [editor, activeTab?.viewMode, activeTab?.id]);

  // Page position: calculate from editor content height and page geometry
  const marginTopPx = marginTop * PX_PER_CM;
  const marginBottomPx = marginBottom * PX_PER_CM;
  const usableHeight = pageHeight ? pageHeight - marginTopPx - marginBottomPx : 0;

  useEffect(() => {
    if (!editor || !isPaperMode || !usableHeight || !activeTab) {
      setPageInfo(null);
      return;
    }

    const updatePageInfo = () => {
      const el = scrollAreaRef.current;
      if (!el) return;

      // Total content height from the ProseMirror DOM
      const contentHeight = editor.view.dom.scrollHeight;
      const totalPages = Math.max(1, Math.ceil(contentHeight / usableHeight));

      // Current page: which page is at the viewport center
      const viewportCenter = el.scrollTop + el.clientHeight / 2;
      const contentOffsetTop =
        editor.view.dom.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop;
      const posInContent = viewportCenter - contentOffsetTop;
      const currentPage = Math.min(
        totalPages,
        Math.max(1, Math.ceil(posInContent / usableHeight))
      );
      setPageInfo({ current: currentPage, total: totalPages });
    };

    // Update on scroll
    let timeout: ReturnType<typeof setTimeout>;
    const onScroll = () => {
      clearTimeout(timeout);
      timeout = setTimeout(updatePageInfo, 100);
    };

    // Update when editor content changes
    const onTransaction = () => {
      clearTimeout(timeout);
      timeout = setTimeout(updatePageInfo, 300);
    };

    const el = scrollAreaRef.current;
    if (el) {
      el.addEventListener('scroll', onScroll, { passive: true });
    }
    editor.on('transaction', onTransaction);

    // Initial calculation — delay to ensure layout is complete
    const initTimeout = setTimeout(updatePageInfo, 200);

    return () => {
      if (el) {
        el.removeEventListener('scroll', onScroll);
      }
      editor.off('transaction', onTransaction);
      clearTimeout(timeout);
      clearTimeout(initTimeout);
    };
  }, [editor, isPaperMode, usableHeight, activeTab?.id]);

  return { pageInfo };
}
