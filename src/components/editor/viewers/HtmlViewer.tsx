import { useState, useEffect, useRef, useCallback } from "react";
import { Code } from "lucide-react";
import { highlightDomMatches, clearDomHighlights } from "@/lib/dom-search";
import { FindBar } from "@/components/editor/FindBar";
import { CodeEditor } from "./CodeEditor";

interface HtmlViewerProps {
  content: string;
  fileName: string;
  filePath: string;
  tabId: string;
  isDirty: boolean;
  updateTabContent: (content: string) => void;
  saveFileWithContent: (content: string) => void;
}

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

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const searchMatchesRef = useRef<HTMLElement[]>([]);

  // Write HTML into the sandboxed iframe when content or mode changes
  useEffect(() => {
    if (sourceMode) return;
    const iframe = iframeRef.current;
    if (!iframe) return;
    const doc = iframe.contentDocument;
    if (!doc) return;
    doc.open();
    doc.write(content);
    doc.close();
  }, [content, sourceMode]);

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

  const getSearchContainer = useCallback((): HTMLElement | null => {
    return iframeRef.current?.contentDocument?.body ?? null;
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

  if (sourceMode) {
    return (
      <div className="h-full flex flex-col">
        {/* Toolbar */}
        <div className="h-9 border-b border-border px-3 flex items-center gap-2 shrink-0 bg-background">
          <span className="text-xs text-muted-foreground truncate max-w-[200px]">
            {fileName}
          </span>
          {isDirty && (
            <span className="text-xs text-muted-foreground">●</span>
          )}
          <div className="ml-auto">
            <button
              type="button"
              aria-label="Switch to rendered view"
              onClick={() => setSourceMode(false)}
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <Code className="h-3.5 w-3.5" aria-hidden="true" />
              Source
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
      {/* Toolbar */}
      <div className="h-9 border-b border-border px-3 flex items-center gap-2 shrink-0 bg-background">
        <span className="text-xs text-muted-foreground truncate max-w-[200px]">
          {fileName}
        </span>
        <div className="ml-auto">
          <button
            type="button"
            aria-label="Switch to source view"
            onClick={() => setSourceMode(true)}
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <Code className="h-3.5 w-3.5" aria-hidden="true" />
            Source
          </button>
        </div>
      </div>

      {/* Content area with FindBar overlay */}
      <div ref={scrollContainerRef} className="flex-1 overflow-hidden relative">
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
        {/* Sandboxed iframe — allow-same-origin for local asset loading, no allow-scripts */}
        <iframe
          ref={iframeRef}
          title={fileName}
          sandbox="allow-same-origin"
          className="w-full h-full border-0 bg-white"
          aria-label={`Rendered HTML: ${fileName}`}
        />
      </div>
    </div>
  );
}
