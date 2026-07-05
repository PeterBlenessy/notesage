import { useEffect, useRef, useState, type MutableRefObject, type RefObject } from "react";
import type { Editor as TiptapEditor } from "@tiptap/core";
import { useEditorStore, type Tab } from "@/stores/editor-store";
import type { EditorStateCache } from "@/lib/editor-state-cache";
import { useSettingsStore } from "@/stores/settings-store";
import {
  AISuggestionPluginKey,
  setSuggestion,
} from "@/components/editor/extensions";
import { findNthTagInDoc, scrollPosToCenter, scrollToTextInEditor, PX_PER_CM } from "@/components/editor/editor-utils";
import { loadRawMarkdownIntoEditor, streamingHydrate, type TableColumnMetadataMap, type ColumnMetadata } from "@/lib/markdown";
import { parseInWorker } from "@/lib/markdown-worker";
import { parsedDocCache } from "@/lib/parsed-doc-cache";
import { getCachedViewport, setCachedViewport, contentFingerprint } from "@/lib/viewport-cache";
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
  cachedEditorStatesRef: MutableRefObject<EditorStateCache>;
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

  // Tracks the file path of the previously activated tab. We can't derive this
  // from `lastLoadedTabId` because Quiet Composer's single-doc shell evicts
  // the previous tab from `openDocuments` BEFORE this effect runs — the id
  // is still valid as a Map key, but the lookup to recover its filePath fails.
  // Keying the EditorState cache by filePath (not tab.id) lets the cache
  // survive eviction-and-reopen of the same file.
  const lastLoadedFilePathRef = useRef<string | null>(null);

  // AbortController for the in-flight worker parse + post-preview setContent
  // chain. When a new tab is activated we abort the previous controller —
  // the worker's eventual result is dropped and we never call `setContent`
  // for a tab the user has already clicked away from. Without this guard,
  // rapid clicks pile up worker parses + setContent operations and the
  // editor flashes through every cancelled tab in sequence (the "queue
  // flicker" UX). The worker bridge already supports `AbortSignal` (see
  // `markdown-worker.ts`); we just have to plug it in.
  const abortInFlightRef = useRef<AbortController | null>(null);

  const [pageInfo, setPageInfo] = useState<PageInfo | null>(null);

  // Update editor content when switching tabs or when placeholder content finishes loading.
  useEffect(() => {
    if (!editor || !activeTab || activeTab.contentLoaded === false) return;
    if (activeTab.id === lastLoadedTabId.current) return;
      // Cancel anything in-flight from the previous activation BEFORE starting
      // any new work. New controller per activation; the .then/.catch handlers
      // close over `abortController` and bail if `signal.aborted`.
      abortInFlightRef.current?.abort();
      // Clear the preview dedup marker alongside the abort. Tauri invokes
      // can't be cancelled, so an aborted activation's preview call may still
      // be in flight — its result will be dropped by the signal check, but
      // its `.finally` hasn't run yet. Without this clear, a fast A→B→A
      // switch hits the `previewInFlightRef.current === tabIdOnEntry` guard
      // on the second A and early-returns, leaving the tab stuck on its
      // preview/loading state. The `.finally` clear remains as a backstop.
      previewInFlightRef.current = null;
      const abortController = new AbortController();
      abortInFlightRef.current = abortController;

      const switchT0 = performance.now();
      const fileName = activeTab.filePath.split("/").pop() ?? activeTab.filePath;
      const contentBytes = activeTab.content ? new TextEncoder().encode(activeTab.content).length : 0;
      const contentSizeKB = +(contentBytes / 1024).toFixed(1);

      // Save full editor state of the tab we're LEAVING (preserves undo/redo, selection, decorations).
      // EditorState is keyed by filePath so it survives single-doc-shell eviction;
      // the AI-suggestion side cache stays keyed by tab.id (suggestions are
      // tab-scoped and don't need to survive eviction — losing one is graceful).
      const prevTabId = lastLoadedTabId.current;
      const prevFilePath = lastLoadedFilePathRef.current;
      if (prevFilePath) {
        cachedEditorStatesRef.current.set(prevFilePath, editor.state);
      }
      if (prevTabId) {
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

      const cachedState = cachedEditorStatesRef.current.get(activeTab.filePath);
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
      lastLoadedFilePathRef.current = activeTab.filePath;
      const tabIdOnEntry = activeTab.id;

      // Set document directory BEFORE setContent so image nodes resolve paths correctly.
      // Also set projectRoot so the paste handler writes image sidecars to the correct
      // <project>/.notesage/images/ directory (or ~/.notesage/images/ for non-project files).
      const imageStorage = getEditorStorage<EditorStorageImage>(editor, 'image');
      if (imageStorage) {
        imageStorage.documentDir = getDocumentDir(activeTab.filePath);
        imageStorage.projectRoot =
          projectPath ?? useSettingsStore.getState().homeDir ?? undefined;
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
        log.debug("perf:doc-switch", "Editor state restored", { file: fileName, sizeKB: contentSizeKB, restore: restoreMethod, setupMs: +(performance.now() - switchT0).toFixed(1) });

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
            log.debug("perf:doc-switch", "Doc visible", { file: fileName, scroll: "tag", totalMs: +(performance.now() - switchT0).toFixed(1) });
          }); });
        } else if (activeTab.scrollToText) {
          const text = activeTab.scrollToText;
          setScrollToText(activeTab.id, undefined);
          requestAnimationFrame(() => { requestAnimationFrame(() => {
            scrollToTextInEditor(editor, text, scrollAreaRef.current, isProgrammaticScroll);
            if (scrollAreaRef.current) scrollAreaRef.current.style.opacity = '1';
            log.debug("perf:doc-switch", "Doc visible", { file: fileName, scroll: "text", totalMs: +(performance.now() - switchT0).toFixed(1) });
          }); });
        } else {
          restoreScrollRatio(activeTab.filePath, () => {
            if (scrollAreaRef.current) scrollAreaRef.current.style.opacity = '1';
            log.debug("perf:doc-switch", "Doc visible", { file: fileName, scroll: "position", totalMs: +(performance.now() - switchT0).toFixed(1) });
          });
        }
      };

      // ---------------------------------------------------------------
      // Path selection
      // ---------------------------------------------------------------

      if (pendingExternal !== undefined && !activeTab.isDirty) {
        // External change reload — sync, fast.
        cachedEditorStatesRef.current.delete(activeTab.filePath);
        loadRawMarkdownIntoEditor(editor, pendingExternal);
        updateTabContent(activeTab.id, pendingExternal, false);
        clearExternalChange(activeTab.filePath);
        toast("File updated from disk", { id: "external-change", description: activeTab.fileName });
        useEditorStore.getState().setPreviewState(activeTab.id, "hydrated");
        runPostLoad(false);
      } else if (cachedState) {
        // Cached editor state — sync, instant restore.
        editor.view.updateState(cachedState);
        cachedEditorStatesRef.current.delete(activeTab.filePath);
        useEditorStore.getState().setPreviewState(activeTab.id, "hydrated");
        runPostLoad(true);
      } else if (isFreshMarkdownParse && contentBytes >= SKIP_PREVIEW_THRESHOLD_BYTES && useSettingsStore.getState().instantLoadPreview) {
        // IDB VIEWPORT CACHE PATH — large-file cold start only.
        // Check IDB for a cached viewport snapshot from a previous session.
        // On hit: show the cached HTML immediately (<50 ms) as a static preview,
        // then hydrate in background. On miss: fall through to normal preview path.
        const tabContent = activeTab.content;
        const tabFilePath = activeTab.filePath;
        const fp = contentFingerprint(tabContent);

        getCachedViewport(tabFilePath, fp).then((cached) => {
          if (abortController.signal.aborted) return;
          const current = useEditorStore.getState().openDocuments.find((t) => t.id === tabIdOnEntry);
          if (!current || current.previewState === "hydrated") return;

          if (!cached) {
            // Cache miss — run the normal preview path inline.
            const resolvedTheme: "light" | "dark" =
              document.documentElement.classList.contains("dark") ? "dark" : "light";
            if (previewInFlightRef.current === tabIdOnEntry) return;
            previewInFlightRef.current = tabIdOnEntry;
            useEditorStore.getState().setPreviewState(activeTab.id, "loading");

            tauriApi
              .renderMarkdownPreview({
                path: tabFilePath,
                projectRoot: projectPath ?? undefined,
                theme: resolvedTheme,
              })
              .then((html) => {
                if (abortController.signal.aborted) return;
                const cur = useEditorStore.getState().openDocuments.find((t) => t.id === tabIdOnEntry);
                if (!cur || cur.previewState === "hydrated") return;
                useEditorStore.getState().setPreview(tabIdOnEntry, html);
                if (scrollAreaRef.current) scrollAreaRef.current.style.opacity = '1';
                const pipelineStart = performance.now();
                const cachedParse = parsedDocCache.get(tabFilePath);
                const parsePromise = cachedParse
                  ? Promise.resolve(cachedParse)
                  : parseInWorker(tabContent, projectPath ?? undefined, { signal: abortController.signal });
                const fromCache = cachedParse !== undefined;
                parsePromise
                  .then((parseResult) => {
                    if (abortController.signal.aborted) return;
                    const c2 = useEditorStore.getState().openDocuments.find((t) => t.id === tabIdOnEntry);
                    if (!c2 || c2.previewState === "hydrated") return;
                    if (!fromCache) parsedDocCache.set(tabFilePath, parseResult);
                    deferPastPaint(() => {
                      if (abortController.signal.aborted) return;
                      const sideMaps = deserializeSideMaps(parseResult);
                      streamingHydrate(editor, parseResult.doc, sideMaps, abortController.signal)
                        .then((streamResult) => {
                          if (streamResult.aborted) return;
                          useEditorStore.getState().setPreviewState(tabIdOnEntry, "hydrated");
                          runPostLoad(false);
                          log.debug("perf:doc-switch", "Editor hydrated (idb-miss → preview)", {
                            file: fileName,
                            sizeKB: contentSizeKB,
                            pipelineMs: +(performance.now() - pipelineStart).toFixed(1),
                            chunkCount: streamResult.chunkCount,
                            streamMs: +streamResult.ms.toFixed(1),
                            totalMs: +(performance.now() - switchT0).toFixed(1),
                          });
                        });
                    });
                  })
                  .catch((err) => {
                    if (err?.name === "AbortError") return;
                    deferPastPaint(() => {
                      if (abortController.signal.aborted) return;
                      loadRawMarkdownIntoEditor(editor, tabContent);
                      useEditorStore.getState().setPreviewState(tabIdOnEntry, "hydrated");
                      runPostLoad(false);
                    });
                  });
              })
              .catch((err) => {
                if (abortController.signal.aborted) return;
                console.warn("Preview render failed (idb-miss path):", tabFilePath, err);
                useEditorStore.getState().setPreviewState(tabIdOnEntry, "idle");
                loadRawMarkdownIntoEditor(editor, tabContent);
                runPostLoad(false);
              })
              .finally(() => {
                if (previewInFlightRef.current === tabIdOnEntry) {
                  previewInFlightRef.current = null;
                }
              });
            return;
          }

          // Cache HIT — show cached HTML immediately as static preview.
          const paintT0 = performance.now();
          useEditorStore.getState().setPreview(tabIdOnEntry, cached.html);
          // Restore scroll position. Prefer the live saved RATIO (tracked on
          // every scroll, debounced 150 ms in `useScrollPersistence`) over
          // `cached.scrollY` which is only captured 5 s after an EDIT and
          // goes stale if the user scrolled to a new position without
          // editing — that staleness was the "opens some paragraphs down"
          // bug. Fallback to the cached pixel position only if no ratio is
          // saved yet.
          const savedRatio =
            useEditorStore.getState().scrollPositions[activeTab.filePath];
          requestAnimationFrame(() => {
            const el = scrollAreaRef.current;
            if (el) {
              if (savedRatio !== undefined) {
                const maxScroll = el.scrollHeight - el.clientHeight;
                el.scrollTop = savedRatio * Math.max(0, maxScroll);
              } else {
                el.scrollTop = cached.scrollY;
              }
              el.style.opacity = '1';
            }
            log.debug("perf:doc-switch", "Viewport cache hit — first paint", {
              file: fileName,
              sizeKB: contentSizeKB,
              paintMs: +(performance.now() - paintT0).toFixed(1),
              totalMs: +(performance.now() - switchT0).toFixed(1),
            });
          });

          // Background hydration: parse + streaming hydrate while the cached
          // HTML is visible. When done, swap in the live editor via deferPastPaint.
          const pipelineStart = performance.now();
          const cachedParse = parsedDocCache.get(tabFilePath);
          const parsePromise = cachedParse
            ? Promise.resolve(cachedParse)
            : parseInWorker(tabContent, projectPath ?? undefined, { signal: abortController.signal });
          const fromCache = cachedParse !== undefined;
          if (fromCache) {
            log.debug("perf:doc-switch", "Parse cache hit (idb-viewport)", { file: fileName });
          }

          parsePromise
            .then((parseResult) => {
              if (abortController.signal.aborted) return;
              const cur = useEditorStore.getState().openDocuments.find((t) => t.id === tabIdOnEntry);
              if (!cur || cur.previewState === "hydrated") return;
              if (!fromCache) parsedDocCache.set(tabFilePath, parseResult);
              deferPastPaint(() => {
                if (abortController.signal.aborted) return;
                const sideMaps = deserializeSideMaps(parseResult);
                streamingHydrate(editor, parseResult.doc, sideMaps, abortController.signal)
                  .then((streamResult) => {
                    if (streamResult.aborted) {
                      log.debug("perf:doc-switch", "Hydration aborted (idb-viewport)", {
                        file: fileName,
                        chunkCount: streamResult.chunkCount,
                        streamMs: +streamResult.ms.toFixed(1),
                      });
                      return;
                    }
                    useEditorStore.getState().setPreviewState(tabIdOnEntry, "hydrated");
                    runPostLoad(false);
                    log.debug("perf:doc-switch", "Editor hydrated after idb-viewport cache hit", {
                      file: fileName,
                      sizeKB: contentSizeKB,
                      fromCache,
                      pipelineMs: +(performance.now() - pipelineStart).toFixed(1),
                      workerPreprocess: fromCache ? 0 : parseResult.timings.preprocess,
                      workerParse: fromCache ? 0 : parseResult.timings.parse,
                      chunkCount: streamResult.chunkCount,
                      streamMs: +streamResult.ms.toFixed(1),
                      totalMs: +(performance.now() - switchT0).toFixed(1),
                    });
                  });
              });
            })
            .catch((err) => {
              if (err?.name === "AbortError") return;
              console.warn("Worker parse failed (idb-viewport); falling back:", tabFilePath, err);
              deferPastPaint(() => {
                if (abortController.signal.aborted) return;
                loadRawMarkdownIntoEditor(editor, tabContent);
                useEditorStore.getState().setPreviewState(tabIdOnEntry, "hydrated");
                runPostLoad(false);
              });
            });
        }).catch(() => {
          // IDB unavailable — fall through to the legacy synchronous path.
          loadRawMarkdownIntoEditor(editor, activeTab.content);
          useEditorStore.getState().setPreviewState(activeTab.id, "hydrated");
          runPostLoad(false);
        });
      } else if (
        isFreshMarkdownParse &&
        (contentBytes < SKIP_PREVIEW_THRESHOLD_BYTES ||
          !useSettingsStore.getState().instantLoadPreview)
      ) {
        // SKIP-PREVIEW PATH — fires for:
        //   1. Small files (<50 KB) — preview render+swap adds latency
        //      and CSS divergence without a user-visible win at this size.
        //      PRD § "Layer 1b — Skip-preview rule" (Phase 3b).
        //   2. ANY file when the user has disabled `instantLoadPreview`
        //      in System settings — explicit preference to skip the
        //      preview/editor visual swap during loads.
        //
        // In both cases the worker parses, then `streamingHydrate` mounts
        // the editor in chunks. No comrak preview is ever rendered.
        const tabContent = activeTab.content;
        const tabFilePath = activeTab.filePath;
        log.debug("perf:doc-switch", "Skip-preview (small file)", {
          file: fileName,
          sizeKB: contentSizeKB,
        });
        useEditorStore.getState().setPreviewState(activeTab.id, "loading");
        const pipelineStart = performance.now();

        // Try the parsed-doc cache first — if a previous activation parsed
        // this file (even if its hydration was aborted mid-stream), we can
        // skip the worker round-trip entirely.
        const cachedParse = parsedDocCache.get(tabFilePath);
        const parsePromise = cachedParse
          ? Promise.resolve(cachedParse)
          : parseInWorker(tabContent, projectPath ?? undefined, { signal: abortController.signal });
        const fromCache = cachedParse !== undefined;
        if (fromCache) {
          log.debug("perf:doc-switch", "Parse cache hit (skip-preview)", { file: fileName });
        }

        parsePromise
          .then((parseResult) => {
            if (abortController.signal.aborted) return;
            const current = useEditorStore.getState().openDocuments.find((t) => t.id === tabIdOnEntry);
            if (!current || current.previewState === "hydrated") return;
            // Cache the parse result for future revisits — even if the
            // streaming hydrate below gets aborted mid-stream, the parsed
            // ProseMirror JSON is still valid and worth keeping.
            if (!fromCache) parsedDocCache.set(tabFilePath, parseResult);

            deferPastPaint(() => {
              if (abortController.signal.aborted) return;
              const sideMaps = deserializeSideMaps(parseResult);
              streamingHydrate(editor, parseResult.doc, sideMaps, abortController.signal)
                .then((streamResult) => {
                  if (streamResult.aborted) {
                    log.debug("perf:doc-switch", "Hydration aborted (skip-preview)", {
                      file: fileName,
                      chunkCount: streamResult.chunkCount,
                      topLevelNodes: streamResult.topLevelNodes,
                      streamMs: +streamResult.ms.toFixed(1),
                    });
                    return;
                  }
                  useEditorStore.getState().setPreviewState(tabIdOnEntry, "hydrated");
                  runPostLoad(false);
                  log.debug("perf:doc-switch", "Editor hydrated (skip-preview)", {
                    file: fileName,
                    sizeKB: contentSizeKB,
                    fromCache,
                    pipelineMs: +(performance.now() - pipelineStart).toFixed(1),
                    workerPreprocess: fromCache ? 0 : parseResult.timings.preprocess,
                    workerParse: fromCache ? 0 : parseResult.timings.parse,
                    chunkCount: streamResult.chunkCount,
                    streamMs: +streamResult.ms.toFixed(1),
                    totalMs: +(performance.now() - switchT0).toFixed(1),
                  });
                });
            });
          })
          .catch((err) => {
            // Aborted parses are expected when the user switches away — silent.
            if (err?.name === "AbortError") return;
            // Worker errored — fall back to legacy main-thread parse.
            console.warn("Worker parse failed (skip-preview); falling back:", activeTab.filePath, err);
            deferPastPaint(() => {
              if (abortController.signal.aborted) return;
              loadRawMarkdownIntoEditor(editor, tabContent);
              useEditorStore.getState().setPreviewState(tabIdOnEntry, "hydrated");
              runPostLoad(false);
              log.debug("perf:doc-switch", "Editor hydrated (skip-preview, worker-fallback)", {
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
          log.debug("perf:doc-switch", "Preview already in flight — skip duplicate fire", { file: fileName });
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
            // Bail if the user has switched to a different tab (abort fired),
            // the tab was closed, or an external-change reload took over.
            if (abortController.signal.aborted) return;
            const current = useEditorStore.getState().openDocuments.find((t) => t.id === tabIdOnEntry);
            if (!current || current.previewState === "hydrated") return;
            log.debug("perf:doc-load", "Preview ready", { file: fileName, previewMs: +(performance.now() - previewT0).toFixed(1) });

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
            const pipelineStart = performance.now();
            const tabFilePath = activeTab.filePath;
            const cachedParse = parsedDocCache.get(tabFilePath);
            const parsePromise = cachedParse
              ? Promise.resolve(cachedParse)
              : parseInWorker(tabContent, projectPath ?? undefined, { signal: abortController.signal });
            const fromCache = cachedParse !== undefined;
            if (fromCache) {
              log.debug("perf:doc-switch", "Parse cache hit (preview)", { file: fileName });
            }

            parsePromise
              .then((parseResult) => {
                if (abortController.signal.aborted) return;
                // Bail if the user has switched away or external-change reload
                // took over while the worker was running.
                const current = useEditorStore.getState().openDocuments.find((t) => t.id === tabIdOnEntry);
                if (!current || current.previewState === "hydrated") return;
                // Cache the worker output so an aborted hydration doesn't
                // throw away the ~300 ms parse work.
                if (!fromCache) parsedDocCache.set(tabFilePath, parseResult);

                deferPastPaint(() => {
                  if (abortController.signal.aborted) return;
                  const sideMaps = deserializeSideMaps(parseResult);
                  streamingHydrate(editor, parseResult.doc, sideMaps, abortController.signal)
                    .then((streamResult) => {
                      if (streamResult.aborted) {
                        log.debug("perf:doc-switch", "Hydration aborted (preview)", {
                          file: fileName,
                          chunkCount: streamResult.chunkCount,
                          topLevelNodes: streamResult.topLevelNodes,
                          streamMs: +streamResult.ms.toFixed(1),
                        });
                        return;
                      }
                      useEditorStore.getState().setPreviewState(tabIdOnEntry, "hydrated");
                      runPostLoad(false);
                      log.debug("perf:doc-switch", "Editor hydrated after preview (worker)", {
                        file: fileName,
                        sizeKB: contentSizeKB,
                        fromCache,
                        pipelineMs: +(performance.now() - pipelineStart).toFixed(1),
                        workerPreprocess: fromCache ? 0 : parseResult.timings.preprocess,
                        workerParse: fromCache ? 0 : parseResult.timings.parse,
                        chunkCount: streamResult.chunkCount,
                        streamMs: +streamResult.ms.toFixed(1),
                        totalMs: +(performance.now() - switchT0).toFixed(1),
                      });
                    });
                });
              })
              .catch((err) => {
                // Aborted parses are expected when the user switches away — silent.
                if (err?.name === "AbortError") return;
                // Worker errored — fall back to legacy main-thread parse.
                console.warn("Worker parse failed; falling back to main-thread parse:", activeTab.filePath, err);
                deferPastPaint(() => {
                  if (abortController.signal.aborted) return;
                  loadRawMarkdownIntoEditor(editor, tabContent);
                  useEditorStore.getState().setPreviewState(tabIdOnEntry, "hydrated");
                  runPostLoad(false);
                  log.debug("perf:doc-switch", "Editor hydrated after preview (worker-fallback)", {
                    file: fileName,
                    sizeKB: contentSizeKB,
                    reason: err instanceof Error ? err.message : String(err),
                    totalMs: +(performance.now() - switchT0).toFixed(1),
                  });
                });
              });
          })
          .catch((err) => {
            // Aborted preview = user switched away; silent bail.
            if (abortController.signal.aborted) return;
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

  // Unmount-only cleanup for the tab-switch pipeline. This deliberately does
  // NOT live as a cleanup return on the main effect above: that effect's deps
  // include per-render callbacks (`updateTabContent`, `externalChanges`, …),
  // so it re-fires frequently and relies on the `activeTab.id ===
  // lastLoadedTabId.current` early-return to no-op — React would run an
  // unconditional cleanup BEFORE each such re-fire, spuriously aborting the
  // current tab's in-flight hydration with nothing restarting it. A separate
  // mount-scoped effect fires its cleanup only when the hook (i.e. the
  // Editor) unmounts, which is exactly when the in-flight parse/hydrate
  // chain must stop writing to the soon-to-be-destroyed editor.
  //
  // The load-tracking refs are reset too so a remount with surviving refs
  // (React StrictMode's dev double-mount) re-runs the pipeline instead of
  // early-returning against the pipeline this cleanup just aborted.
  useEffect(() => {
    return () => {
      abortInFlightRef.current?.abort();
      abortInFlightRef.current = null;
      previewInFlightRef.current = null;
      lastLoadedTabId.current = null;
      lastLoadedFilePathRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // Invalidate the parsed-doc cache (and schedule a viewport capture) when the
  // user makes a real edit (transaction.docChanged AND NOT a bulk-load
  // transaction tagged `addToHistory: false`). Bulk loads come from
  // `streamingHydrate` / `loadRawMarkdownIntoEditor` and we want to KEEP
  // the cache entries we just populated. User edits change the on-disk
  // intent, so future cache hits would be against stale source — drop parsedDocCache.
  // Schedule a viewport capture 5s after the last edit (idle trigger).
  useEffect(() => {
    if (!editor || !activeTab) return;
    const filePath = activeTab.filePath;
    let captureTimeout: ReturnType<typeof setTimeout> | undefined;

    const onTransaction = ({ transaction }: { transaction: { docChanged: boolean; getMeta: (key: string) => unknown } }) => {
      if (!transaction.docChanged) return;
      if (transaction.getMeta("addToHistory") === false) return; // bulk load — keep cache

      // Invalidate in-memory parse cache — content has diverged.
      parsedDocCache.delete(filePath);

      // Debounce viewport capture: 5 s after last user edit.
      clearTimeout(captureTimeout);
      captureTimeout = setTimeout(() => {
        // Capture only when the editor is fully hydrated (not during streaming).
        const tab = useEditorStore.getState().openDocuments.find((t) => t.filePath === filePath);
        if (!tab || tab.previewState !== "hydrated") return;
        const html = editor.getHTML();
        const el = scrollAreaRef.current;
        const scrollY = el ? el.scrollTop : 0;
        const byteSize = new TextEncoder().encode(html).length;
        const fp = contentFingerprint(tab.content ?? '');
        setCachedViewport(filePath, fp, {
          html,
          scrollY,
          capturedAt: Date.now(),
          byteSize,
        });
      }, 5000);
    };

    editor.on('transaction', onTransaction);
    return () => {
      editor.off('transaction', onTransaction);
      clearTimeout(captureTimeout);
    };
  }, [editor, activeTab?.filePath, scrollAreaRef]);

  // When switching from Source → WYSIWYG, reload editor with current tab content
  const prevViewMode = useRef(activeTab?.viewMode);
  useEffect(() => {
    if (!editor || !activeTab) return;
    const wasSource = prevViewMode.current === "source";
    const isNowWysiwyg = activeTab.viewMode !== "source";
    prevViewMode.current = activeTab.viewMode;

    if (wasSource && isNowWysiwyg) {
      cachedEditorStatesRef.current.delete(activeTab.filePath);
      loadRawMarkdownIntoEditor(editor, activeTab.content);
      // Re-set image storage in case it was lost
      const imgStorage = getEditorStorage<EditorStorageImage>(editor, 'image');
      if (imgStorage) {
        imgStorage.documentDir = getDocumentDir(activeTab.filePath);
        imgStorage.projectRoot =
          projectPath ?? useSettingsStore.getState().homeDir ?? undefined;
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
