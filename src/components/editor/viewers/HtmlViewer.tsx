import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Code, Eye, ShieldAlert } from "lucide-react";
import DOMPurify from "dompurify";
import { invoke } from "@tauri-apps/api/core";
import { highlightDomMatches, clearDomHighlights } from "@/lib/dom-search";
import { FindBar } from "@/components/editor/FindBar";
import { CodeEditor } from "./CodeEditor";
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

interface HtmlViewerProps {
  content: string;
  fileName: string;
  filePath: string;
  tabId: string;
  isDirty: boolean;
  updateTabContent: (content: string) => void;
  saveFileWithContent: (content: string) => void;
}

const ZOOM_STEP = 1.1;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2.0;

// Form tags + attributes that round-trip submission. Forbidden by default so a
// sanitised .html file can't ship a covert "click here to submit" form. The
// `htmlViewerAllowForms` setting (Settings > System) re-allows them for users
// who explicitly want to render local docs that contain real forms.
const FORM_TAGS = ["form", "input", "button", "select", "textarea", "label", "fieldset", "legend", "option", "optgroup"];
const FORM_ATTRS = ["action", "method", "name", "for", "type", "value", "placeholder", "checked", "selected", "disabled", "readonly", "required", "min", "max", "step", "pattern"];

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
 * `htmlViewerAllowForms` opt-in (Settings > System) keeps `<form>` and its
 * controls in the sanitised tree so local docs with real forms render. Default
 * off — a hostile-document threat model treats forms as exfil surfaces.
 */
export function HtmlViewer({
  content,
  fileName,
  filePath,
  tabId,
  isDirty,
  updateTabContent,
  saveFileWithContent,
}: HtmlViewerProps) {
  const allowForms = useSettingsStore((s) => s.htmlViewerAllowForms);
  const allowScripts = useSettingsStore((s) => s.htmlViewerAllowScripts);
  const [sourceMode, setSourceMode] = useState(false);
  const [unsafeHtml, setUnsafeHtml] = useState<string | null>(null);
  const [findBarOpen, setFindBarOpen] = useState(false);
  const [searchMatches, setSearchMatches] = useState<HTMLElement[]>([]);
  const [searchCurrentIndex, setSearchCurrentIndex] = useState(-1);
  const [zoom, setZoom] = useState(1.0);
  const [unsafeMode, setUnsafeMode] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);

  const renderRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const searchMatchesRef = useRef<HTMLElement[]>([]);

  // Strip the `<head>` chunk before rendering — global selectors in the
  // file's stylesheet would bleed into the surrounding app chrome.
  // `<body>` content is rendered as a sanitised inline tree.
  const sanitisedBody = useMemo(() => {
    // Pull out body if a full document was supplied; otherwise treat the
    // whole content as fragment.
    const bodyMatch = content.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    const fragment = bodyMatch ? bodyMatch[1] : content;
    const baseForbidTags = ["script", "iframe", "object", "embed"];
    return DOMPurify.sanitize(fragment, {
      ALLOW_DATA_ATTR: false,
      FORBID_TAGS: allowForms ? baseForbidTags : [...baseForbidTags, ...FORM_TAGS],
      ADD_ATTR: allowForms ? FORM_ATTRS : [],
    });
  }, [content, allowForms]);

  // When allow-scripts is ON, pre-process the raw HTML: read same-directory
  // <script src="./..."> files via Tauri read_file and rewrite them as inline
  // <script> blocks so the iframe (which has a null/opaque origin — no
  // allow-same-origin) can execute them without a cross-origin fetch.
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
      if (!cancelled) setUnsafeHtml(processed);
    }
    process();
    return () => { cancelled = true; };
  }, [allowScripts, content, filePath]);

  // Reset search state when switching modes or content changes
  useEffect(() => {
    setFindBarOpen(false);
    setSearchMatches([]);
    searchMatchesRef.current = [];
    setSearchCurrentIndex(-1);
  }, [sourceMode, content]);

  // Unsafe mode is session-only — reset when the user switches to a different tab
  useEffect(() => {
    setUnsafeMode(false);
    setShowConfirmDialog(false);
  }, [tabId]);

  // Listen for Cmd+F / notesage:find-open — only active in rendered mode
  useEffect(() => {
    if (sourceMode) return;
    const handleFindOpen = () => setFindBarOpen(true);
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
          marks[0].scrollIntoView({ behavior: "smooth", block: "center" });
          marks[0].classList.add("dom-find-highlight-active");
        });
      } else {
        setSearchCurrentIndex(-1);
      }
    },
    [getSearchContainer],
  );

  const scrollToMatch = useCallback((index: number, marks: HTMLElement[]) => {
    for (const m of marks) m.classList.remove("dom-find-highlight-active");
    marks[index].classList.add("dom-find-highlight-active");
    marks[index].scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  const handleNext = useCallback(() => {
    const marks = searchMatchesRef.current;
    if (marks.length === 0) return;
    setSearchCurrentIndex((prev) => {
      const next = (prev + 1) % marks.length;
      scrollToMatch(next, marks);
      return next;
    });
  }, [scrollToMatch]);

  const handlePrevious = useCallback(() => {
    const marks = searchMatchesRef.current;
    if (marks.length === 0) return;
    setSearchCurrentIndex((prev) => {
      const prevIdx = (prev - 1 + marks.length) % marks.length;
      scrollToMatch(prevIdx, marks);
      return prevIdx;
    });
  }, [scrollToMatch]);

  const handleClose = useCallback(() => {
    setFindBarOpen(false);
    const container = getSearchContainer();
    if (container) clearDomHighlights(container);
    setSearchMatches([]);
    searchMatchesRef.current = [];
    setSearchCurrentIndex(-1);
  }, [getSearchContainer]);

  const toolbarClass =
    "h-9 border-b border-border px-3 flex items-center gap-2 shrink-0 bg-background";

  if (sourceMode) {
    return (
      <div className="h-full flex flex-col">
        <div className={toolbarClass} data-testid="html-viewer-toolbar">
          <span className="text-xs text-muted-foreground truncate max-w-[200px]">
            {fileName}
          </span>
          {isDirty && <span className="text-xs text-muted-foreground">●</span>}
          <span className="text-xs text-muted-foreground ml-2">Source</span>
          <div className="ml-auto">
            <button
              type="button"
              aria-label="Switch to rendered view"
              onClick={() => setSourceMode(false)}
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors border border-border"
            >
              <Eye className="h-3.5 w-3.5" aria-hidden="true" />
              Rendered
            </button>
          </div>
        </div>
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

      <div className="h-full flex flex-col">
        <div className={toolbarClass} data-testid="html-viewer-toolbar">
          <span className="text-xs text-muted-foreground truncate max-w-[200px]">
            {fileName}
          </span>
          <span className="text-xs text-muted-foreground ml-2">
            {unsafeMode ? "Unsafe preview" : "Rendered"}
          </span>
          {!unsafeMode && zoom !== 1.0 && (
            <span
              className="text-xs text-muted-foreground ml-2 tabular-nums"
              aria-label="Zoom level"
            >
              {Math.round(zoom * 100)}%
            </span>
          )}
          <div className="ml-auto flex items-center gap-1.5">
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
              className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors border ${
                unsafeMode
                  ? "bg-destructive/10 text-destructive border-destructive/30 hover:bg-destructive/20"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground border-border"
              }`}
            >
              <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
              Unsafe preview
            </button>
            <button
              type="button"
              aria-label="Switch to source view"
              onClick={() => setSourceMode(true)}
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors border border-border"
            >
              <Code className="h-3.5 w-3.5" aria-hidden="true" />
              Source
            </button>
          </div>
        </div>

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
          className="flex-1 overflow-auto relative p-3"
        >
          {unsafeMode ? (
            <iframe
              srcDoc={content}
              sandbox="allow-scripts"
              className="w-full h-full border-0 rounded-lg"
              title={`Unsafe preview: ${fileName}`}
            />
          ) : (
            <>
              <FindBar
                open={findBarOpen}
                onClose={handleClose}
                matchCount={searchMatches.length}
                currentMatch={searchCurrentIndex}
                onSearch={handleSearch}
                onNext={handleNext}
                onPrevious={handlePrevious}
                replaceEnabled={false}
                replaceExpanded={false}
                onReplaceExpandedChange={() => {}}
              />
              {allowScripts && unsafeHtml !== null ? (
                <iframe
                  sandbox="allow-scripts"
                  srcDoc={unsafeHtml}
                  title={`Rendered HTML (scripts enabled): ${fileName}`}
                  aria-label={`Rendered HTML: ${fileName}`}
                  className="w-full h-full rounded-lg border border-border shadow-sm bg-white"
                  style={{ minHeight: "60vh", zoom }}
                />
              ) : (
                <div
                  ref={renderRef}
                  className="bg-white text-black rounded-lg border border-border shadow-sm p-6 max-w-3xl mx-auto"
                  style={{ zoom }}
                  aria-label={`Rendered HTML: ${fileName}`}
                  dangerouslySetInnerHTML={{ __html: sanitisedBody }}
                />
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
