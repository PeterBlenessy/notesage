import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Eye, ShieldAlert, Search, ChevronUp, ChevronDown, X } from "lucide-react";
import { cn } from "@/lib/utils";
import DOMPurify from "dompurify";
import { invoke } from "@tauri-apps/api/core";
import { highlightDomMatches, clearDomHighlights } from "@/lib/dom-search";
import { injectFindScript, HTML_FIND_NS, type HtmlFindResult } from "./html-find-frame";
import { CodeEditor } from "./CodeEditor";
import { ViewerToolbarPill } from "./ViewerToolbarPill";
import { useSettingsStore } from "@/stores/settings-store";
import { registerZoomController } from "@/hooks/useEditorZoom";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// Strip attributes containing external (http/https) URLs from a raw HTML string.
// Applied before content reaches any render path when blockExternal is ON,
// so the guarantee holds for the sanitised-div, allowScripts iframe, and
// unsafe-preview iframe paths equally.
function stripExternalResources(html: string): string {
  // Preserve DOCTYPE — DOMParser strips it from outerHTML serialisation.
  const doctypeMatch = html.match(/^(\s*<!DOCTYPE[^>]*>)/i);
  const doctype = doctypeMatch ? doctypeMatch[1] : "";

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const externalPattern = /^https?:/i;
  const cssUrlExternal = /url\(\s*['"]?https?:[^'")\s]+['"]?\s*\)/gi;

  for (const el of Array.from(doc.querySelectorAll("[src]"))) {
    const val = el.getAttribute("src");
    if (val && externalPattern.test(val)) el.removeAttribute("src");
  }
  for (const el of Array.from(doc.querySelectorAll("[href]"))) {
    const val = el.getAttribute("href");
    if (val && externalPattern.test(val)) el.removeAttribute("href");
  }
  for (const el of Array.from(doc.querySelectorAll("[srcset]"))) {
    const val = el.getAttribute("srcset");
    if (val) {
      const filtered = val
        .split(",")
        .filter((s) => !externalPattern.test(s.trim()))
        .join(",");
      if (filtered.trim()) {
        el.setAttribute("srcset", filtered);
      } else {
        el.removeAttribute("srcset");
      }
    }
  }
  // Strip CSS url(https://…) from inline style attributes.
  for (const el of Array.from(doc.querySelectorAll("[style]"))) {
    const val = el.getAttribute("style");
    if (val) {
      const stripped = val.replace(cssUrlExternal, "url()");
      if (stripped !== val) el.setAttribute("style", stripped);
    }
  }
  // Strip CSS url(https://…) from <style> block text content.
  for (const el of Array.from(doc.querySelectorAll("style"))) {
    if (el.textContent) {
      el.textContent = el.textContent.replace(cssUrlExternal, "url()");
    }
  }
  // Strip external URLs from additional resource-bearing attributes.
  for (const attr of ["poster", "formaction", "ping", "action", "data"]) {
    for (const el of Array.from(doc.querySelectorAll(`[${attr}]`))) {
      const val = el.getAttribute(attr);
      if (val && externalPattern.test(val)) el.removeAttribute(attr);
    }
  }
  return doctype + doc.documentElement.outerHTML;
}

interface HtmlViewerProps {
  content: string;
  fileName: string;
  filePath: string;
  tabId: string;
  isDirty: boolean;
  updateTabContent: (content: string) => void;
  saveFileWithContent: (content: string) => void;
  sourceMode?: boolean;
  onToggleSourceMode?: () => void;
}

const ZOOM_STEP = 1.1;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2.0;

const PILL_BTN =
  "inline-flex items-center gap-1 h-7 px-2 rounded-full text-xs hover:bg-muted/60 transition-colors disabled:opacity-50 disabled:pointer-events-none";

function PillDivider() {
  return (
    <span
      className="w-px h-3.5 bg-border/60 mx-0.5"
      aria-hidden="true"
    />
  );
}



/**
 * HtmlViewer — render an HTML file directly in a sanitised div with the
 * normal app shell around it. No iframe, no separate document — keyboard
 * shortcuts, theme toggle, find-in-document, view-zoom all work the same way
 * they do everywhere else in the app.
 *
 * Security: DOMPurify strips `<script>` tags, `on*` event handlers, and
 * javascript: URIs. Files come from the user's local disk; the threat model
 * is "user opens an untrusted .html file received over email" — not a remote
 * web page. Sanitised inline render is the same shape we already use for
 * markdown HTML and AI-suggested HTML, so the viewer is no longer a special
 * surface that other features have to know about.
 *
 * Two orthogonal security settings (Settings > System):
 * - `htmlViewerBlockExternalResources`: strips remote http/https URLs from all
 *   render paths via `stripExternalResources()`. Applied consistently regardless
 *   of which render path (sanitised-div, allowScripts iframe, unsafe-preview).
 * - `htmlViewerAllowScripts`: renders in an isolated `sandbox="allow-scripts"`
 *   iframe. Forms and event handlers are included when scripts are enabled.
 */
export function HtmlViewer({
  content,
  fileName,
  filePath,
  tabId,
  isDirty,
  updateTabContent,
  saveFileWithContent,
  sourceMode: sourceModeControlled,
  onToggleSourceMode,
}: HtmlViewerProps) {
  const allowScripts = useSettingsStore((s) => s.htmlViewerAllowScripts);
  const blockExternal = useSettingsStore((s) => s.htmlViewerBlockExternalResources);
  const [sourceModeInternal, setSourceModeInternal] = useState(false);
  const sourceMode = sourceModeControlled ?? sourceModeInternal;
  const setSourceMode = onToggleSourceMode ?? (() => setSourceModeInternal((v) => !v));
  const [unsafeHtml, setUnsafeHtml] = useState<string | null>(null);
  const [findBarOpen, setFindBarOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMatches, setSearchMatches] = useState<HTMLElement[]>([]);
  const [searchCurrentIndex, setSearchCurrentIndex] = useState(-1);
  // Match count for the iframe paths (div mode uses searchMatches.length instead).
  const [frameMatchCount, setFrameMatchCount] = useState(0);
  const [zoom, setZoom] = useState(1.0);
  const [unsafeMode, setUnsafeMode] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);

  const renderRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const searchMatchesRef = useRef<HTMLElement[]>([]);

  // Search runs inside the sandboxed iframe (via postMessage) in the
  // allow-scripts / unsafe-preview paths; in the default sanitised-div path it
  // runs over the host DOM.
  const isIframeMode = allowScripts || unsafeMode;
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Whether the content is empty or whitespace-only (triggers placeholder)
  const isEmpty = content.trim() === "";

  // Strip the `<head>` chunk before rendering — global selectors in the
  // file's stylesheet would bleed into the surrounding app chrome.
  // `<body>` content is rendered as a sanitised inline tree.
  const sanitisedBody = useMemo(() => {
    // Use DOMParser to extract body content — handles false </body> tags
    // inside <pre> blocks or HTML comments that would truncate the regex approach.
    const parsed = new DOMParser().parseFromString(content, "text/html");
    const fragment = parsed.body.innerHTML || content;

    // Apply external-resource stripping before DOMPurify so the guarantee
    // is consistent with the iframe render paths (which use the same utility).
    const processedFragment = blockExternal
      ? stripExternalResources(fragment)
      : fragment;

    return DOMPurify.sanitize(processedFragment, {
      ALLOW_DATA_ATTR: false,
      FORBID_TAGS: ["script", "iframe", "object", "embed"],
    });
  }, [content, blockExternal]);

  // When allow-scripts is ON, pre-process the raw HTML: read same-directory
  // <script src="./..."> files via Tauri read_file and rewrite them as inline
  // <script> blocks so the iframe (which has a null/opaque origin — no
  // allow-same-origin) can execute them without a cross-origin fetch.
  // When blockExternal is also ON, strip external URLs after script inlining.
  useEffect(() => {
    if (!allowScripts) {
      setUnsafeHtml(null);
      return;
    }
    let cancelled = false;
    async function process() {
      const dir = filePath.substring(0, filePath.lastIndexOf("/"));
      // Match <script src="./relative/path.js"> patterns (single or double quotes)
      const srcPattern = /<script\s[^>]*src=["'](\.\/[^"']+)["'][^>]*><\/script>/gi;
      let processed = content;
      const matches = [...content.matchAll(srcPattern)];
      for (const match of matches) {
        const relPath = match[1];
        const absPath = `${dir}/${relPath.replace(/^\.\//, "")}`;
        try {
          const fileContent = await invoke<string>("read_file", { path: absPath });
          processed = processed.replace(match[0], `<script>${fileContent}</script>`);
        } catch {
          // If file can't be read, leave the original tag in place
        }
      }
      if (blockExternal) {
        processed = stripExternalResources(processed);
      }
      if (!cancelled) setUnsafeHtml(processed);
    }
    process();
    return () => { cancelled = true; };
  }, [allowScripts, content, filePath, blockExternal]);

  // Content for the unsafe-preview iframe, with optional external-resource
  // stripping when blockExternal is ON. Memoised to avoid re-parsing on every
  // render when the content has not changed.
  const unsafePreviewContent = useMemo(
    () => (blockExternal ? stripExternalResources(content) : content),
    [content, blockExternal],
  );

  // The HTML shown in the sandboxed iframe (unsafe-preview or allow-scripts
  // path), or null when neither iframe path is active (default sanitised div).
  const iframeContent =
    unsafeMode
      ? unsafePreviewContent
      : allowScripts && unsafeHtml !== null
        ? unsafeHtml
        : null;

  // Render the iframe from a blob: URL rather than `srcDoc`. A `srcdoc` document
  // INHERITS the host window's Content-Security-Policy, and Tauri's CSP rewrite
  // injects a style nonce that neutralises `'unsafe-inline'` — so a srcdoc frame
  // refuses the document's own inline <style> blocks and web-font <link>s
  // (regression after the app gained a CSP). A blob: document gets its own
  // (empty) CSP context, so the document's styles + fonts apply normally, while
  // the `sandbox="allow-scripts"` (no allow-same-origin) isolation is unchanged.
  // `frame-src` already permits `blob:`, so the app-level CSP is not relaxed.
  const [iframeUrl, setIframeUrl] = useState<string | null>(null);
  useEffect(() => {
    if (iframeContent === null) {
      setIframeUrl(null);
      return;
    }
    // Inject the in-frame find script so Cmd+F / the search bar can search the
    // rendered (sandboxed, cross-origin) document via postMessage.
    const html = injectFindScript(iframeContent);
    const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    setIframeUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [iframeContent]);

  // Receive match count / current index from the in-frame search script.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== iframeRef.current?.contentWindow) return;
      const d = e.data as HtmlFindResult | undefined;
      if (!d || d.ns !== HTML_FIND_NS) return;
      setFrameMatchCount(d.count);
      setSearchCurrentIndex(d.current);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  /** Send a command to the in-frame find script. */
  const postFind = useCallback((action: "search" | "next" | "prev" | "clear", query?: string) => {
    iframeRef.current?.contentWindow?.postMessage({ ns: HTML_FIND_NS, action, query }, "*");
  }, []);

  // Reset search state when switching modes, content changes, or iframe mode toggles.
  useEffect(() => {
    setFindBarOpen(false);
    setSearchQuery("");
    setSearchMatches([]);
    searchMatchesRef.current = [];
    setSearchCurrentIndex(-1);
    setFrameMatchCount(0);
  }, [sourceMode, content, unsafeMode, allowScripts]);

  // Unsafe mode is session-only — reset when the user switches to a different tab
  useEffect(() => {
    setUnsafeMode(false);
    setShowConfirmDialog(false);
  }, [tabId]);

  // Zoom is per-file — reset to 1.0 when the tab changes so it doesn't leak.
  useEffect(() => {
    setZoom(1.0);
  }, [tabId]);

  // Listen for Cmd+F / notesage:find-open. Active in the rendered view (both the
  // sanitised-div path and the sandboxed-iframe paths, which search in-frame via
  // postMessage). Disabled only in source mode (CodeMirror owns find there).
  useEffect(() => {
    if (sourceMode) return;
    const handleFindOpen = () => {
      setFindBarOpen(true);
      requestAnimationFrame(() => searchInputRef.current?.focus());
    };
    window.addEventListener("notesage:find-open", handleFindOpen);
    return () => window.removeEventListener("notesage:find-open", handleFindOpen);
  }, [sourceMode]);

  // Register as the active zoom controller while rendered. ⌘+ / ⌘- / ⌘0
  // scale the rendered tree via CSS `zoom` (#188).
  useEffect(() => {
    if (sourceMode) return;
    return registerZoomController({
      in: () =>
        setZoom((z) => Math.min(ZOOM_MAX, Math.round(z * ZOOM_STEP * 100) / 100)),
      out: () =>
        setZoom((z) => Math.max(ZOOM_MIN, Math.round((z / ZOOM_STEP) * 100) / 100)),
      reset: () => setZoom(1.0),
    });
  }, [sourceMode]);

  const getSearchContainer = useCallback((): HTMLElement | null => {
    return renderRef.current ?? null;
  }, []);

  const handleSearch = useCallback(
    (query: string) => {
      // Iframe paths: search runs inside the sandboxed frame via postMessage.
      if (isIframeMode) {
        postFind("search", query);
        if (!query) setSearchCurrentIndex(-1);
        return;
      }
      // Default sanitised-div path: search the host DOM.
      const container = getSearchContainer();
      if (!container) return;
      clearDomHighlights(container);
      if (!query) {
        setSearchMatches([]);
        searchMatchesRef.current = [];
        setSearchCurrentIndex(-1);
        return;
      }
      const marks = highlightDomMatches(container, query);
      setSearchMatches(marks);
      searchMatchesRef.current = marks;
      if (marks.length > 0) {
        setSearchCurrentIndex(0);
        requestAnimationFrame(() => {
          marks[0]?.scrollIntoView?.({ behavior: "smooth", block: "center" });
          marks[0]?.classList.add("dom-find-highlight-active");
        });
      } else {
        setSearchCurrentIndex(-1);
      }
    },
    [isIframeMode, postFind, getSearchContainer],
  );

  const scrollToMatch = useCallback((index: number, marks: HTMLElement[]) => {
    for (const m of marks) m.classList.remove("dom-find-highlight-active");
    marks[index]?.classList.add("dom-find-highlight-active");
    marks[index]?.scrollIntoView?.({ behavior: "smooth", block: "center" });
  }, []);

  const handleNext = useCallback(() => {
    if (isIframeMode) {
      postFind("next");
      return;
    }
    const marks = searchMatchesRef.current;
    if (marks.length === 0) return;
    setSearchCurrentIndex((prev) => {
      const next = (prev + 1) % marks.length;
      scrollToMatch(next, marks);
      return next;
    });
  }, [isIframeMode, postFind, scrollToMatch]);

  const handlePrevious = useCallback(() => {
    if (isIframeMode) {
      postFind("prev");
      return;
    }
    const marks = searchMatchesRef.current;
    if (marks.length === 0) return;
    setSearchCurrentIndex((prev) => {
      const prevIdx = (prev - 1 + marks.length) % marks.length;
      scrollToMatch(prevIdx, marks);
      return prevIdx;
    });
  }, [isIframeMode, postFind, scrollToMatch]);

  const handleClose = useCallback(() => {
    setFindBarOpen(false);
    setSearchQuery("");
    if (isIframeMode) {
      postFind("clear");
    } else {
      const container = getSearchContainer();
      if (container) clearDomHighlights(container);
    }
    setSearchMatches([]);
    searchMatchesRef.current = [];
    setSearchCurrentIndex(-1);
    setFrameMatchCount(0);
  }, [isIframeMode, postFind, getSearchContainer]);

  if (sourceMode) {
    return (
      <div className="h-full flex flex-col relative">
        <ViewerToolbarPill viewerId="html" scrollRef={scrollContainerRef} className="absolute top-4 left-1/2 -translate-x-1/2">
          <button
            type="button"
            aria-label="Switch to rendered view"
            onClick={setSourceMode}
            className={cn(PILL_BTN, "text-muted-foreground")}
          >
            <Eye className="h-3.5 w-3.5" strokeWidth={1.5} />
            <span>Rendered</span>
          </button>
        </ViewerToolbarPill>
        <div className="flex-1 min-h-0 overflow-hidden">
          <CodeEditor
            content={content}
            fileName={fileName}
            filePath={filePath}
            tabId={tabId}
            isDirty={isDirty}
            updateTabContent={updateTabContent}
            saveFileWithContent={saveFileWithContent}
          />
        </div>
      </div>
    );
  }

  return (
    <>
      <AlertDialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Enable Unsafe Preview Mode?</AlertDialogTitle>
            <AlertDialogDescription>
              This file will render unmodified HTML including all scripts —
              inline and external (CDN). Only enable for files you trust.
              DOMPurify sanitisation will be bypassed for this session.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setUnsafeMode(true);
                setShowConfirmDialog(false);
              }}
            >
              Accept
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="h-full flex flex-col relative">
        <ViewerToolbarPill viewerId="html" scrollRef={scrollContainerRef} className="absolute top-4 left-1/2 -translate-x-1/2">
          {findBarOpen ? (
            <>
              <Search className="h-3.5 w-3.5 text-muted-foreground ml-1.5 shrink-0" strokeWidth={1.5} />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  handleSearch(e.target.value);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (e.shiftKey) handlePrevious(); else handleNext();
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    handleClose();
                  }
                }}
                placeholder="Find…"
                className="bg-transparent border-none outline-none text-xs text-foreground placeholder:text-muted-foreground w-28 px-1"
                aria-label="Find in document"
                // eslint-disable-next-line jsx-a11y/no-autofocus
                autoFocus
              />
              {(isIframeMode ? frameMatchCount : searchMatches.length) > 0 && (
                <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
                  {searchCurrentIndex + 1}/{isIframeMode ? frameMatchCount : searchMatches.length}
                </span>
              )}
              <button type="button" onClick={handlePrevious} className={cn(PILL_BTN, "text-muted-foreground px-1")} aria-label="Previous match">
                <ChevronUp className="h-3.5 w-3.5" strokeWidth={1.5} />
              </button>
              <button type="button" onClick={handleNext} className={cn(PILL_BTN, "text-muted-foreground px-1")} aria-label="Next match">
                <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.5} />
              </button>
              <button type="button" onClick={handleClose} className={cn(PILL_BTN, "text-muted-foreground px-1")} aria-label="Close find">
                <X className="h-3.5 w-3.5" strokeWidth={1.5} />
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                aria-label="Unsafe preview mode"
                title={
                  unsafeMode
                    ? "Unsafe preview active — scripts are executing"
                    : "Enable unsafe preview mode (renders scripts)"
                }
                onClick={() => {
                  if (!unsafeMode) {
                    setShowConfirmDialog(true);
                  } else {
                    setUnsafeMode(false);
                  }
                }}
                className={cn(
                  PILL_BTN,
                  unsafeMode
                    ? "bg-destructive/10 text-destructive"
                    : "text-muted-foreground",
                )}
              >
                <ShieldAlert className="h-3.5 w-3.5" strokeWidth={1.5} />
                {unsafeMode && <span>Unsafe</span>}
              </button>
              <PillDivider />
              <button
                type="button"
                onClick={() => {
                  setFindBarOpen(true);
                  requestAnimationFrame(() => searchInputRef.current?.focus());
                }}
                className={cn(PILL_BTN, "text-muted-foreground")}
                title="Find (Cmd+F)"
                aria-label="Find"
              >
                <Search className="h-3.5 w-3.5" strokeWidth={1.5} />
              </button>
              {!unsafeMode && zoom !== 1.0 && (
                <>
                  <PillDivider />
                  <span className="text-xs text-muted-foreground tabular-nums px-1">
                    {Math.round(zoom * 100)}%
                  </span>
                </>
              )}
            </>
          )}
        </ViewerToolbarPill>

        {/* Content area. Three render paths, in priority order:
            1. Unsafe preview mode (user clicked toolbar toggle + accepted dialog) —
               raw HTML in a sandboxed iframe. Most aggressive: bypasses everything
               including the DOMPurify pass; lets CDN + inline scripts execute.
               Session-only, per-tab.
            2. `htmlViewerAllowScripts` setting ON — pre-processed HTML (local
               <script src="./..."> resolved + inlined) in a sandboxed iframe.
               Persistent across sessions; local scripts only.
            3. Default — DOMPurify sanitised inline div. */}
        <div
          ref={scrollContainerRef}
          className="flex-1 overflow-auto relative"
        >
          {unsafeMode ? (
            <iframe
              ref={iframeRef}
              src={iframeUrl ?? undefined}
              sandbox="allow-scripts"
              className="w-full h-full border-0"
              title={`Unsafe preview: ${fileName}`}
            />
          ) : isEmpty ? (
            <div
              className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground"
              aria-label={`Rendered HTML: ${fileName}`}
            >
              <span className="text-sm font-medium">This HTML file is empty</span>
              <span className="text-xs">0 bytes</span>
            </div>
          ) : allowScripts && unsafeHtml !== null ? (
            <iframe
              ref={iframeRef}
              sandbox="allow-scripts"
              src={iframeUrl ?? undefined}
              title={`Rendered HTML (scripts enabled): ${fileName}`}
              aria-label={`Rendered HTML: ${fileName}`}
              className="w-full h-full border-0"
              style={{ minHeight: "60vh", zoom }}
            />
          ) : (
            <div className="p-6">
              <div
                ref={renderRef}
                className="bg-white text-black rounded-lg border border-border shadow-sm p-6 max-w-3xl mx-auto"
                style={{ zoom }}
                aria-label={`Rendered HTML: ${fileName}`}
                dangerouslySetInnerHTML={{ __html: sanitisedBody }}
              />
            </div>
          )}
        </div>
      </div>
    </>
  );
}
