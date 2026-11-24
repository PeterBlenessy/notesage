import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from "react";
import { Eye, ShieldAlert, Search, ChevronUp, ChevronDown, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { invoke } from "@tauri-apps/api/core";
import { resolveLocalScriptPath } from "@/lib/html-local-script";
import {
  stripExternalResources,
  prepareHtmlBody,
  mountPreparedHtml,
  preparedHtmlCost,
  htmlSanitiseCache,
  htmlSanitiseVariant,
  HTML_DEFER_MIN_CHARS,
  type PreparedHtmlBody,
} from "@/lib/html-viewer-sanitise";
import { log, PERF } from "@/lib/logger";
import { highlightDomMatches, clearDomHighlights } from "@/lib/dom-search";
import {
  injectFindScript,
  HTML_FIND_NS,
  HTML_KEY_NS,
  type HtmlFindResult,
  type HtmlKeyMessage,
} from "./html-find-frame";
import { CodeEditor } from "./CodeEditor";
import { ViewerToolbarPill } from "./ViewerToolbarPill";
import { useSettingsStore } from "@/stores/settings-store";
import { registerZoomController } from "@/hooks/useEditorZoom";
import { useReducedMotion } from "@/hooks/useReducedMotion";
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

/**
 * Run `work` once the browser has had a chance to paint, so the viewer's
 * chrome is on screen before a large document is sanitised. Returns a cancel
 * function; a cancelled job never runs.
 *
 * `requestAnimationFrame` does not fire in a hidden or occluded window, so a
 * plain timer backs it up.
 */
function afterNextPaint(work: () => void): () => void {
  let settled = false;
  let frame = 0;
  let afterFrame = 0;
  const cancel = () => {
    settled = true;
    if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(frame);
    window.clearTimeout(afterFrame);
    window.clearTimeout(fallback);
  };
  const run = () => {
    if (settled) return;
    cancel();
    work();
  };
  const fallback = window.setTimeout(run, 150);
  if (typeof requestAnimationFrame === "function") {
    frame = requestAnimationFrame(() => {
      afterFrame = window.setTimeout(run, 0);
    });
  }
  return cancel;
}

interface DeferredBody {
  content: string;
  blockExternal: boolean;
  prepared: PreparedHtmlBody;
}

interface SanitisedHtmlBodyProps {
  prepared: PreparedHtmlBody | null;
  hostRef: React.RefObject<HTMLDivElement | null>;
  zoom: number;
  fileName: string;
}

/**
 * The sanitised render surface. Its children are written by hand rather than
 * through `dangerouslySetInnerHTML`, because large inlined images are put
 * back on the parsed elements after the (small) sanitised string is parsed.
 */
function SanitisedHtmlBody({ prepared, hostRef, zoom, fileName }: SanitisedHtmlBodyProps) {
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    if (prepared === null) {
      host.replaceChildren();
      return;
    }
    mountPreparedHtml(host, prepared, true);
  }, [prepared, hostRef]);

  return (
    <div className="p-6">
      <div
        ref={hostRef}
        className="bg-white text-black rounded-lg border border-border shadow-sm p-6 max-w-3xl mx-auto"
        style={{ zoom }}
        aria-label={`Rendered HTML: ${fileName}`}
        aria-busy={prepared === null ? true : undefined}
      />
    </div>
  );
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

/** How much of the document is looked at for a doctype. */
const DOCTYPE_PROBE_CHARS = 256;

/**
 * True when the document already opens with `<!doctype` (after a BOM and
 * leading whitespace) — the first check of Rust's `repair_missing_doctype`,
 * made on the first few characters instead of the whole string. Anything
 * else (including more leading whitespace than the probe holds) is `false`,
 * which only means Rust gets asked.
 */
function opensWithDoctype(content: string): boolean {
  const head = content.slice(0, DOCTYPE_PROBE_CHARS).replace(/^﻿+/, "").trimStart();
  return head.slice(0, 9).toLowerCase() === "<!doctype";
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
  // `findClosing` keeps the find UI mounted briefly so its exit animation can
  // play before it unmounts (open and close both animate — see openFind /
  // handleClose). The pill content swaps in place, so this reads as the search
  // button morphing to/from the search field.
  const [findClosing, setFindClosing] = useState(false);
  const findCloseTimerRef = useRef<number | null>(null);
  const reducedMotion = useReducedMotion();
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
  // Latest find state, mirrored to refs so the iframe `onLoad` handler (a stable
  // callback) can read them without re-subscribing — used to re-apply the active
  // search once the sandboxed document is ready (see handleIframeLoad).
  const searchQueryRef = useRef(searchQuery);
  searchQueryRef.current = searchQuery;
  const findBarOpenRef = useRef(findBarOpen);
  findBarOpenRef.current = findBarOpen;

  // Search runs inside the sandboxed iframe (via postMessage) in the
  // allow-scripts / unsafe-preview paths; in the default sanitised-div path it
  // runs over the host DOM.
  const isIframeMode = allowScripts || unsafeMode;
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Open the find bar, cancelling any in-flight close animation, and focus the
  // input on the next frame (after it mounts).
  const openFind = useCallback(() => {
    if (findCloseTimerRef.current !== null) {
      window.clearTimeout(findCloseTimerRef.current);
      findCloseTimerRef.current = null;
    }
    setFindClosing(false);
    setFindBarOpen(true);
    requestAnimationFrame(() => searchInputRef.current?.focus());
  }, []);

  // Drop the close-animation timer if the component unmounts mid-exit.
  useEffect(
    () => () => {
      if (findCloseTimerRef.current !== null) {
        window.clearTimeout(findCloseTimerRef.current);
      }
    },
    [],
  );

  // Repair a saved article that lost its `<!doctype html>` to #805.
  //
  // The desktop half of the same repair the mobile Reader does. It is NOT
  // enough to rely on the phone fixing the file and iCloud carrying it over:
  // an article only ever opened here would stay in quirks mode forever, and
  // these documents are meant to be portable — opened in a browser, Quick
  // Looked, handed to someone. So they are repaired wherever they are opened.
  //
  // The decision is Rust's (`repair_missing_doctype`), shared with the mobile
  // path rather than reimplemented here, so the two cannot drift.
  //
  // Skipped while the tab is dirty: `content` then carries the user's unsaved
  // edits, and saving to fix fifteen bytes would silently commit those too.
  // The repair is idempotent, so the next clean open gets it.
  //
  // Whether there is anything to ask is decided HERE, on the first bytes: a
  // document that opens with a doctype needs no repair, and asking Rust meant
  // sending the whole capture — megabytes, with its inlined images — across
  // IPC on every open to be told so. Rust still decides the repair itself.
  useEffect(() => {
    if (isDirty) return;
    if (opensWithDoctype(content)) return;
    let cancelled = false;
    void invoke<string | null>("repair_html_doctype", { content })
      .then((repaired) => {
        if (cancelled || !repaired) return;
        updateTabContent(repaired);
        saveFileWithContent(repaired);
      })
      .catch(() => {
        // A build without the command, or an IPC failure. A missing doctype is
        // a formatting problem, not a reason to fail the view.
      });
    return () => {
      cancelled = true;
    };
    // Keyed on the FILE, not on `content`: reacting to content would re-fire on
    // the very update this effect performs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath]);

  // Whether the content is empty or whitespace-only (triggers placeholder)
  const isEmpty = content.trim() === "";

  // Whether the sanitised inline tree is what is on screen. Source mode and
  // the two iframe paths never show it, so they never pay for it — this used
  // to be recomputed on every keystroke in source mode.
  const sanitisedActive =
    !sourceMode && !unsafeMode && !isEmpty && !(allowScripts && unsafeHtml !== null);

  // The `<head>` is stripped before rendering — global selectors in the
  // file's stylesheet would bleed into the surrounding app chrome. `<body>`
  // content is rendered as a sanitised inline tree (see
  // `lib/html-viewer-sanitise.ts` for the pipeline).
  //
  // A small document, or a large one that was prepared recently, is ready
  // during render. A large one that was not is prepared after a paint (below).
  const readyBody = useMemo(() => {
    if (!sanitisedActive) return null;
    if (content.length < HTML_DEFER_MIN_CHARS) return prepareHtmlBody(content, blockExternal);
    return htmlSanitiseCache.get(filePath, htmlSanitiseVariant(blockExternal), content);
  }, [sanitisedActive, content, blockExternal, filePath]);

  const [deferredBody, setDeferredBody] = useState<DeferredBody | null>(null);
  const [deferredError, setDeferredError] = useState<unknown>(null);
  const needsDeferredBody = sanitisedActive && readyBody === null;

  // A saved web page is megabytes of inlined images. Preparing it inside
  // render kept the previous document on screen, frozen, until it finished;
  // here the viewer's chrome paints first. Stepping to another item before
  // the work starts cancels it, so ⌘↓ ⌘↓ ⌘↓ prepares one document, not three.
  useEffect(() => {
    if (!needsDeferredBody) return;
    return afterNextPaint(() => {
      const startedAt = performance.now();
      try {
        const prepared = prepareHtmlBody(content, blockExternal);
        htmlSanitiseCache.set(
          filePath,
          htmlSanitiseVariant(blockExternal),
          content,
          prepared,
          preparedHtmlCost(content, prepared),
        );
        log.perf(PERF.docLoad, "html viewer prepared", {
          chars: content.length,
          sanitisedChars: prepared.sanitisedChars,
          liftedImages: prepared.lifted.originals.size,
          liftedChars: prepared.lifted.chars,
          ms: Math.round(performance.now() - startedAt),
        });
        setDeferredBody({ content, blockExternal, prepared });
      } catch (err) {
        setDeferredError(err);
      }
    });
  }, [needsDeferredBody, content, blockExternal, filePath]);

  // A deferred result is only ever shown for the document it was made from,
  // whatever order things finish in.
  const preparedBody =
    readyBody ??
    (deferredBody !== null &&
    deferredBody.content === content &&
    deferredBody.blockExternal === blockExternal
      ? deferredBody.prepared
      : null);

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
        // Only files inside the HTML file's own directory are inlined; a
        // `./../…` src is left as the (unresolvable) tag it was.
        const absPath = resolveLocalScriptPath(dir, match[1]);
        if (absPath === null) continue;
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
  // render when the content has not changed. Only built while the unsafe
  // preview is on: with "block external resources" set, this parsed and
  // re-serialised the whole file on every open for an iframe nobody had
  // asked for.
  const unsafePreviewContent = useMemo(
    () => (!unsafeMode ? "" : blockExternal ? stripExternalResources(content) : content),
    [content, blockExternal, unsafeMode],
  );

  // The HTML shown in the sandboxed iframe (unsafe-preview or allow-scripts
  // path), or null when neither iframe path is active (default sanitised div).
  const iframeContent =
    unsafeMode
      ? unsafePreviewContent
      : allowScripts && unsafeHtml !== null
        ? unsafeHtml
        : null;

  // Serve the iframe document from the `htmlpreview://` custom scheme rather than
  // a `blob:` URL or `srcDoc`. Both `srcDoc` and `blob:` documents INHERIT the
  // host window's Content-Security-Policy: once the app gained a hardened CSP
  // (`frame-ancestors 'none'` + a nonce-rewritten `style-src` that drops
  // `'unsafe-inline'`), the framed document was refused in production — the frame
  // blanked and its inline <style> blocks were rejected. The bug hid in dev only
  // because `tauri dev` serves the app over Vite with no CSP header to inherit.
  // A custom-scheme response carries its own (empty) policy, so the document
  // renders regardless of the app CSP; `sandbox="allow-scripts"` (no
  // allow-same-origin) still isolates it. See commands/html_preview.rs.
  const [iframeUrl, setIframeUrl] = useState<string | null>(null);
  useEffect(() => {
    if (iframeContent === null) {
      setIframeUrl(null);
      return;
    }
    // Inject the in-frame find script so Cmd+F / the search bar can search the
    // rendered (sandboxed, cross-origin) document via postMessage.
    const html = injectFindScript(iframeContent);
    const id = crypto.randomUUID();
    let cancelled = false;
    // Register BEFORE pointing the iframe at the id so the handler never 404s.
    invoke("html_preview_register", { id, content: html })
      .then(() => {
        if (!cancelled) setIframeUrl(`htmlpreview://localhost/${id}`);
      })
      .catch((err) => {
        console.error("Failed to register HTML preview document", err);
      });
    return () => {
      cancelled = true;
      void invoke("html_preview_unregister", { id }).catch(() => {});
    };
  }, [iframeContent]);

  // Receive messages from the in-frame script: find results (match count /
  // current index) and forwarded keyboard chords. The frame is sandboxed
  // cross-origin, so its keydown events never reach this window — re-dispatch the
  // forwarded chords on `window` so the app's window-level shortcuts fire while
  // the rendered page has focus.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== iframeRef.current?.contentWindow) return;
      const d = e.data as
        | HtmlFindResult
        | HtmlKeyMessage
        | undefined;
      if (!d) return;
      if (d.ns === HTML_FIND_NS) {
        setFrameMatchCount(d.count);
        setSearchCurrentIndex(d.current);
      } else if (d.ns === HTML_KEY_NS) {
        window.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: d.key,
            code: d.code,
            metaKey: d.metaKey,
            ctrlKey: d.ctrlKey,
            shiftKey: d.shiftKey,
            altKey: d.altKey,
            bubbles: true,
            cancelable: true,
          }),
        );
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  /** Send a command to the in-frame find script. */
  const postFind = useCallback((action: "search" | "next" | "prev" | "clear", query?: string) => {
    iframeRef.current?.contentWindow?.postMessage({ ns: HTML_FIND_NS, action, query }, "*");
  }, []);

  // Re-apply the active find query once the sandboxed iframe document (and its
  // injected find script) has finished loading. This closes a race: a `search`
  // postMessage sent while the document was still loading is dropped silently
  // (the script's message listener isn't registered yet), so the match count
  // never appears and find looks broken. The `load` event fires only after the
  // in-body `<script>` has executed and registered its listener, so re-sending
  // here is guaranteed to land. No-op when find isn't open.
  const handleIframeLoad = useCallback(() => {
    if (findBarOpenRef.current && searchQueryRef.current) {
      postFind("search", searchQueryRef.current);
    }
  }, [postFind]);

  // Reset search state when switching modes, content changes, or iframe mode
  // toggles. This is an instant teardown (no exit animation) — the surface the
  // find bar belonged to is going away.
  useEffect(() => {
    if (findCloseTimerRef.current !== null) {
      window.clearTimeout(findCloseTimerRef.current);
      findCloseTimerRef.current = null;
    }
    setFindBarOpen(false);
    setFindClosing(false);
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
    const handleFindOpen = () => openFind();
    window.addEventListener("notesage:find-open", handleFindOpen);
    return () => window.removeEventListener("notesage:find-open", handleFindOpen);
  }, [sourceMode, openFind]);

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

  // A large document arrives after the find bar can already be open with a
  // query typed into it. Run that query over the tree once it is there (the
  // tree is mounted in a layout effect, which has run by now).
  useEffect(() => {
    if (deferredBody === null) return;
    if (findBarOpenRef.current && searchQueryRef.current) {
      handleSearch(searchQueryRef.current);
    }
    // Keyed on the arrival only; `handleSearch` is read at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deferredBody]);

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
    // Clear match highlights immediately so they don't linger during the exit.
    if (isIframeMode) {
      postFind("clear");
    } else {
      const container = getSearchContainer();
      if (container) clearDomHighlights(container);
    }
    const finish = () => {
      findCloseTimerRef.current = null;
      setFindBarOpen(false);
      setFindClosing(false);
      setSearchQuery("");
      setSearchMatches([]);
      searchMatchesRef.current = [];
      setSearchCurrentIndex(-1);
      setFrameMatchCount(0);
    };
    if (reducedMotion) {
      finish();
      return;
    }
    // Keep the bar mounted for the exit animation (matches .html-find-exit's
    // 240ms), then tear it down.
    setFindClosing(true);
    findCloseTimerRef.current = window.setTimeout(finish, 240);
  }, [isIframeMode, postFind, getSearchContainer, reducedMotion]);

  // A sanitising failure used to surface from render, to the error boundary.
  // Keep that for the deferred path.
  if (deferredError !== null) throw deferredError;

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
          {findBarOpen || findClosing ? (
            <div
              key="html-find-bar"
              className={cn(
                "inline-flex items-center gap-0.5",
                !reducedMotion &&
                  (findClosing ? "html-find-exit" : "html-find-enter"),
              )}
            >
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
            </div>
          ) : (
            <div
              key="html-find-toolbar"
              className={cn(
                "inline-flex items-center gap-0.5",
                !reducedMotion && "html-find-enter",
              )}
            >
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
                onClick={openFind}
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
            </div>
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
          data-doc-scroll=""
          className="flex-1 overflow-auto relative"
        >
          {unsafeMode ? (
            <iframe
              ref={iframeRef}
              src={iframeUrl ?? undefined}
              sandbox="allow-scripts"
              onLoad={handleIframeLoad}
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
              onLoad={handleIframeLoad}
              title={`Rendered HTML (scripts enabled): ${fileName}`}
              aria-label={`Rendered HTML: ${fileName}`}
              className="w-full h-full border-0"
              style={{ minHeight: "60vh", zoom }}
            />
          ) : (
            <SanitisedHtmlBody
              prepared={preparedBody}
              hostRef={renderRef}
              zoom={zoom}
              fileName={fileName}
            />
          )}
        </div>
      </div>
    </>
  );
}
