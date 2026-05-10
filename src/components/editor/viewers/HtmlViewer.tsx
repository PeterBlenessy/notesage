import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Code, Eye } from "lucide-react";
import DOMPurify from "dompurify";
import { highlightDomMatches, clearDomHighlights } from "@/lib/dom-search";
import { FindBar } from "@/components/editor/FindBar";
import { CodeEditor } from "./CodeEditor";
import { registerZoomController } from "@/hooks/useEditorZoom";

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
  const [sourceMode, setSourceMode] = useState(false);
  const [findBarOpen, setFindBarOpen] = useState(false);
  const [searchMatches, setSearchMatches] = useState<HTMLElement[]>([]);
  const [searchCurrentIndex, setSearchCurrentIndex] = useState(-1);
  const [zoom, setZoom] = useState(1.0);

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
    return DOMPurify.sanitize(fragment, {
      // Allow style attributes for layout fidelity, but strip script-bearing
      // surfaces. DOMPurify's defaults already block on*-handlers and
      // javascript: URIs.
      ALLOW_DATA_ATTR: false,
      FORBID_TAGS: ["script", "iframe", "object", "embed"],
    });
  }, [content]);

  // Reset search state when switching modes or content changes
  useEffect(() => {
    setFindBarOpen(false);
    setSearchMatches([]);
    searchMatchesRef.current = [];
    setSearchCurrentIndex(-1);
  }, [sourceMode, content]);

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
    <div className="h-full flex flex-col">
      <div className={toolbarClass} data-testid="html-viewer-toolbar">
        <span className="text-xs text-muted-foreground truncate max-w-[200px]">
          {fileName}
        </span>
        <span className="text-xs text-muted-foreground ml-2">Rendered</span>
        {zoom !== 1.0 && (
          <span
            className="text-xs text-muted-foreground ml-2 tabular-nums"
            aria-label="Zoom level"
          >
            {Math.round(zoom * 100)}%
          </span>
        )}
        <div className="ml-auto">
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

      {/* Content area — sanitised inline render. Padded shell + rounded card
          give the rendered page the same treatment as the markdown editor. */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-auto relative p-3"
      >
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
        <div
          ref={renderRef}
          className="bg-white text-black rounded-lg border border-border shadow-sm p-6 max-w-3xl mx-auto"
          style={{ zoom }}
          aria-label={`Rendered HTML: ${fileName}`}
          dangerouslySetInnerHTML={{ __html: sanitisedBody }}
        />
      </div>
    </div>
  );
}
